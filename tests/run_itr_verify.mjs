// node tests/run_itr_verify.mjs - the CA's checks (app/src/lib/itr/verify.js) on the made-up client of itr_demo.mjs:
// each check compares two INDEPENDENT sources and is Matched only when both are there and agree to the rupee; a fault
// planted in one side is found as a Difference of exactly that amount, both sides with their sources; a side that is not
// there is Missing data, never Matched; what FinCom cannot know is Needs you; an acceptance is bound to the figures and
// lapses when they change; and the gate.
import { importsOf, buildModel } from "../app/src/lib/itr/model.js";
import { compute } from "../app/src/lib/itr/tax.js";
import { verify, gate, fingerprint } from "../app/src/lib/itr/verify.js";
import { dues43B, msme43Bh, kind43B, tallyPbt, pfDedup, settle43B, msmeFifo, adjustments } from "../app/src/lib/itr/books.js";
import { demo } from "./itr_demo.mjs";

let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const cp = (x) => JSON.parse(JSON.stringify(x));
const D0 = await demo("ITR-3");
function run(mut = {}) {
  const D = cp(D0);
  if (mut.demo) mut.demo(D);
  // a planted list of dues / bills goes into the BOOKS, so the model works the add-back out of it (and the answers)
  if ("dues43B" in mut) D.books.dues43B = mut.dues43B;
  if ("msme" in mut) D.books.msme = mut.msme;
  if (mut.books) mut.books(D.books);
  const files = Object.entries(D.booksObj.itr).filter(([, v]) => v && v.kind).map(([k, v]) => Object.assign({ id: k }, v));
  if (mut.files) mut.files(files);
  const imports = importsOf(files), state = Object.assign({}, D.booksObj.itr["2026|state"], mut.state || {});
  const model = buildModel({ entity: mut.entity || D.client.entity, client: D.client, state, books: D.books, imports, due: "20260831", prevState: mut.prevState });
  if (mut.model) mut.model(model);
  const comp = compute(model);
  if (mut.comp) mut.comp(comp);
  const bk = D.books;
  const ctx = { model, main: comp, imports, books: bk, gst: mut.gst || D.gst, tds: mut.tds || bk.tds, form3cd: mut.form3cd || bk.form3cd, pfBooks: "pfBooks" in mut ? mut.pfBooks : bk.sched.pl.pf.cy, esiBooks: mut.esiBooks !== undefined ? mut.esiBooks : bk.esiBooks,
    pf36va: model.pf36va, dues43B: model.dues43B, msme: model.msme, prior43B: model.prior43B, pfProof: bk.pfProof, due: "20260831", answers: state.paidOn || {}, nrAsk: mut.nrAsk || [], coverage: mut.coverage || [], accepted: mut.accepted || {} };
  const cs = verify(ctx), by = (id) => cs.find((c) => c.id === id) || { status: "absent" };
  return { cs, by, comp, model };
}
const base = run(), S = (id) => base.by(id).status;
console.log("no Matched with a side missing");
ok(base.cs.filter((c) => c.status === "matched" && c.a !== undefined && c.b !== undefined).every((c) => c.a && c.b && c.a.amt != null && c.b.amt != null), "every Matched two-sided check has both sides");
console.log("26AS, AIS, TIS");
ok(S("tds_26as") === "matched" && base.by("tds_26as").a.src.includes("TDS RECEIVABLE"), "TDS receivable in the books (60,200) equals 26AS (status F)");
let r = run({ demo: (D) => { D.books.sched.bs.revenueAuth.trace.find((t) => t.ledger === "TDS RECEIVABLE").amt = 55000; } });
ok(r.by("tds_26as").status === "difference" && r.by("tds_26as").diff === -5200, "books short by 5,200: Difference -5,200");
r = run({ demo: (D) => { D.books.sched.bs.revenueAuth.trace = D.books.sched.bs.revenueAuth.trace.filter((t) => !/TDS/.test(t.ledger)); } });
ok(r.by("tds_26as").status === "missing", "no TDS receivable ledger: Missing data, never Matched");
r = run({ files: (fs) => { fs.find((f) => f.kind === "as26").data.tds[0].status = "U"; } });
ok(r.by("tds_status").status === "needs" && r.model.paid.tds.length === 3 && r.by("tds_26as").b.amt === 30200, "a 26AS line with status U is not claimed and is asked (Needs you)");
r = run({ files: (fs) => { fs.find((f) => f.kind === "as26").data.tds[0].status = ""; } });
ok(r.by("tds_status").status === "needs" && r.model.paid.tds.length === 3 && /status not read/.test(r.by("tds_status").rows[0].label), "a 26AS line whose status was not read: not claimed, asked");
ok(S("tcs_26as") === "missing", "26AS shows TCS, the books have no TCS ledger: Missing data");
ok(S("adv_tax") === "matched" && base.by("adv_tax").a.src.includes("ADVANCE TAX"), "the books' advance tax ledger (40,000) equals the 26AS challans");
r = run({ demo: (D) => { D.books.sched.bs.revenueAuth.trace = D.books.sched.bs.revenueAuth.trace.filter((t) => !/ADVANCE TAX/.test(t.ledger)); } });
ok(r.by("adv_tax").status === "missing", "no advance tax ledger in the books: Missing data (never compared with 26AS itself)");
ok(S("ais_interest") === "difference" && base.by("ais_interest").diff === -8400, "AIS interest 60,400 against 52,000: Difference -8,400");
r = run({ state: { osInterest: 8400 } });
ok(r.by("ais_interest").status === "matched" && r.comp.heads.os === base.comp.heads.os + 8400, "the savings interest added: Matched, and it is taxed");
ok(S("ais_gst") === "difference" && base.by("ais_gst").diff === 50000, "GST turnover in the AIS against the return: 50,000");
r = run({ files: (fs) => { fs.find((f) => f.kind === "ais").data.rows.push({ code: "SFT-012", desc: "Sale of immovable property", amount: 4500000, cat: "hv" }); } });
ok(r.by("ais_hv").status === "needs", "a high-value sale in the AIS: Needs you");
r = run({ files: (fs) => { fs.push({ kind: "tis", data: { rows: [{ desc: "Business receipts", amount: 5100000 }] } }); } });
ok(r.by("tis_business").status === "difference" && r.by("tis_business").diff === 200000, "TIS business receipts above the turnover: Difference 2,00,000");
console.log("Tally books (independent sources)");
ok(S("pl_ties") === "matched" && base.by("pl_ties").b.src.includes("Tally"), "Part A-P&L profit equals Tally's own profit and loss");
r = run({ demo: (D) => { D.books.plTally = D.books.plTally + 250; } });
ok(r.by("pl_ties").status === "difference" && r.by("pl_ties").diff === -250, "Tally's P&L 250 apart: Difference");
r = run({ demo: (D) => { D.books.plTally = null; } });
ok(r.by("pl_ties").status === "missing", "Tally's own P&L not available: Missing data");
ok(S("opening") === "matched" && base.by("opening").b.src.includes("balance sheet"), "opening balances equal last year's uploaded balance sheet");
r = run({ demo: (D) => { D.books.pyBs = null; } });
ok(r.by("opening").status === "missing" && r.by("capital").status === "missing", "no last year's balance sheet: opening and capital Missing data");
r = run({ demo: (D) => { D.books.pyBs.total -= 12000; } });
ok(r.by("opening").status === "difference" && r.by("opening").diff === 12000, "opening 12,000 off last year's closing: Difference");
ok(S("capital") === "matched", "capital: opening + profit + introduced - drawings = closing");
r = run({ demo: (D) => { D.books.capital.drawings += 5000; } });
ok(r.by("capital").status === "difference" && r.by("capital").diff === 5000, "a drawing of 5,000 not in the closing capital: Difference");
ok(S("bs_tally") === "matched" && S("ledgers_placed") === "matched", "balance sheet tallies; every ledger placed");
console.log("GST against the filed returns");
ok(S("gst_r1") === "matched" && S("gst_3b") === "matched", "turnover = filed GSTR-1 + the listed reason; filed GSTR-1 = filed GSTR-3B");
r = run({ gst: Object.assign({}, D0.gst, { filedR3b: 4800000 }) });
ok(r.by("gst_3b").status === "difference" && r.by("gst_3b").diff === 50000, "filed 3B 50,000 below filed GSTR-1: Difference");
r = run({ gst: Object.assign({}, D0.gst, { filedR3b: null }) });
ok(r.by("gst_3b").status === "missing", "no filed 3B in FinCom: Missing data");
r = run({ gst: Object.assign({}, D0.gst, { monthsR1: 9 }) });
ok(r.by("gst_months").status === "missing", "three months of filed GSTR-1 missing: Missing data");
console.log("TDS returns, 40(a)(ia), 40(a)(i)");
ok(S("tds_40aia") === "matched" && base.by("tds_40aia").a.amt === 36000 && base.by("tds_40aia").kind === "consistency", "the return's 40(a)(ia) (36,000) equals 30% of the TDS records' sums without TDS (a consistency check)");
ok(S("tds_filed") === "missing" && S("tds_traces") === "missing", "no filed return marked and no TRACES file: the independent TDS checks are Missing data");
r = run({ tds: Object.assign({}, D0.books.tds, { filed: { quarters: ["26Q Q1", "26Q Q2"], tds: 90000, records: 92000 }, notFiled: ["26Q Q3"], traces: { fincom: 92000, traces: 92000, rows: [] } }) });
ok(r.by("tds_filed").status === "difference" && r.by("tds_filed").diff === 2000 && r.by("tds_traces").status === "matched", "records 92,000 against the returns as filed 90,000: Difference 2,000; challans as TRACES consumed them: Matched");
r = run({ demo: (D) => { D.books.f.nrUnpaid = [{ party: "DEMO SOFTWARE INC", section: "195", base: 70000 }]; D.books.adj = adjustments(D.books.f); } });
ok(r.comp.lines.find((l) => l.key === "add:40ai").amt === 70000, "a non-resident's TDS deducted and not deposited: 100% under 40(a)(i) (70,000), not 30%");
r = run({ tds: Object.assign({}, D0.books.tds, { unpaidBase: 50000 }) });
ok(r.by("tds_40aia").status === "difference" && r.by("tds_40aia").diff === -15000, "TDS deducted on 50,000 not deposited by the due date, not added back: Difference -15,000");
r = run({ demo: (D) => { D.books.f.tdsUnpaid = [{ party: "DEMO CONTRACTOR", section: "194C", base: 50000 }]; } });
ok(r.comp.lines.find((l) => l.key === "add:40aia") && true, "the books' undeposited TDS feeds 40(a)(ia)");
r = run({ nrAsk: ["DEMO SOFTWARE INC"] });
ok(r.by("tds_nr").status === "needs", "a foreign-looking party without TDS: resident or not asked (40(a)(i) 100%)");
console.log("PF and ESI");
{ const late = run({ files: (fs) => { fs.splice(fs.findIndex((f) => f.kind === "pfchallan"), 1); }, state: { paidOn: { "36va:PF202504": "20250520" } } });
  ok(late.comp.lines.find((l) => l.key === "add:36va").amt === 5040 && late.by("pf_36va_unknown").status === "absent", "a month with no challan answered 20-05-2025 (after the 15th): the employees' 5,040 disallowed");
  const intime = run({ files: (fs) => { fs.splice(fs.findIndex((f) => f.kind === "pfchallan"), 1); }, state: { paidOn: { "36va:PF202504": "20250514" } } });
  ok(!intime.comp.lines.some((l) => l.key === "add:36va"), "answered 14-05-2025: in time, allowed"); }
ok(S("pf_months") === "missing" && S("pf_36va") === "difference" && base.by("pf_36va").diff === 5040, "PF months missing; April's PF paid 22 May: 36(1)(va) 5,040");
r = run({ files: (fs) => { fs.splice(fs.findIndex((f) => f.kind === "pfchallan"), 1); } });
ok(r.by("pf_36va").status === "matched" && r.by("pf_36va_unknown").status === "needs" && r.by("pf_36va_unknown").noAccept && !r.comp.lines.some((l) => l.key === "add:36va"), "no challan: not disallowed; the payment date asked (Needs you, cannot be noted away)");
ok(S("esi_months") === "missing" && S("esi_books") === "missing", "ESI challan for April only: months Missing; no ESI expense ledger: Missing (not Matched)");
r = run({ esiBooks: 1625, pfBooks: 0, files: (fs) => { fs.splice(fs.findIndex((f) => f.kind === "pfchallan"), 1); fs.splice(fs.findIndex((f) => f.kind === "ecr"), 1); } });
ok(r.by("esi_books").status === "matched" && r.by("pf_months").status === "absent", "an ESI-only employer: the ESI checks run (books 1,625 = challans)");
console.log("43B and 43B(h)");
ok(kind43B("GST PAYABLE").kind === "gst" && !kind43B("GST PAYABLE").on && kind43B("PF PAYABLE").on && kind43B("BONUS PAYABLE").on && kind43B("INTEREST ACCRUED ON BANK LOAN").on && kind43B("TDS PAYABLE").kind === "tds", "43B kinds: GST / TDS listed (not under 43B), PF, bonus, bank interest under 43B");
const d1 = dues43B([{ ledger: "BONUS PAYABLE", closing: 50000, charge: 50000 }, { ledger: "PF PAYABLE", closing: 20000, charge: 20000 }, { ledger: "PROFESSIONAL TAX PAYABLE", closing: 2500, charge: 2500 }],
  [{ ledger: "BONUS PAYABLE", date: "20260910", amt: 50000 }, { ledger: "BONUS PAYABLE", date: "20260810", amt: 5000 }, { ledger: "PF PAYABLE", date: "20260415", amt: 20000 }], "20260831", "20260930", { pf: 0.5 });
const dk = (k) => d1.find((x) => x.kind === k);
ok(dk("bonus").dis === 45000 && dk("pf").dis === 0 && dk("tax").dis === 2500 && !dk("tax").unknown, "bonus 5,000 paid by 31-08 (45,000 not); PF paid in full; professional tax unpaid (books run past the due date)");
// the reviewer's case: a leave provision of 30 lakh at the year end, of which only 3 lakh was charged this year
const lv = (paid) => dues43B([{ ledger: "PROVISION FOR LEAVE ENCASHMENT", opening: 2850000, charge: 300000, closing: 3000000 }], paid ? [{ ledger: "PROVISION FOR LEAVE ENCASHMENT", date: "20260620", amt: paid }] : [], "20261031", "20261130", {})[0];
ok(lv(0).dis === 300000, "43B on this year's charge: leave provision 30,00,000, 3,00,000 charged this year, unpaid: 3,00,000 added back (not 30 lakh)");
ok(lv(100000).dis === 300000 && lv(2800000).dis === 200000 && lv(3000000).dis === 0, "payments after the year end settle the earlier years' balance first (1 lakh: still 3 lakh; 28 lakh: 27 lakh of earlier years first, 2 lakh of the charge left; all paid: nothing)");
ok(dues43B([{ ledger: "BONUS PAYABLE", opening: 0, charge: 40000, closing: 60000 }], [], "20260831", "20260930", {})[0].dis === 40000, "a balance above the year's charge: only the charge is added back");
// PF / ESI: the employer's ledger 43B in full, the employees' ledger never 43B (36(1)(va)), one ledger for both by the ECR's share
const er = dues43B([{ ledger: "PF EMPLOYER CONTRIBUTION PAYABLE", closing: 12000, charge: 12000 }, { ledger: "PF EMPLOYEE CONTRIBUTION PAYABLE", closing: 11000, charge: 11000 }, { ledger: "ESI PAYABLE", closing: 3000, charge: 3000 }], [], "20260831", "20260930", { pf: 0.5, esi: 0.75 });
ok(er[0].role === "er" && er[0].dis === 12000 && er[1].role === "ee" && !er[1].kind43B && er[1].dis === 0 && er[2].dis === 2250, "separate PF ledgers: employer's 12,000 under 43B in full, employees' 11,000 not under 43B; ESI for both: the challan's employer share (75%)");
ok(kind43B("EMPLOYEES' PROVIDENT FUND PAYABLE").role === "" && kind43B("EMPLOYEE PF DEDUCTED").role === "ee" && kind43B("EMPLOYER'S CONTRIBUTION TO ESI PAYABLE").role === "er", "the scheme's own name (Employees' Provident Fund) is a ledger for both; 'employee ... deducted' is the employees'; 'employer's' the employer's");
const esu = dues43B([{ ledger: "ESI PAYABLE", closing: 3000, charge: 3000 }], [], "20260831", "20260930", { esi: null })[0];
ok(esu.unknownShare && !adjustments({ dues43B: [esu] }).adds.length, "ESI payable for both with no March challan: the employer's part unknown, nothing added until it is known");
// a challan and its bank entry are one payment
const dd = pfDedup([{ ledger: "PF PAYABLE", date: "20260415", amt: 20000, narr: "EPF MARCH" }, { ledger: "PF PAYABLE", date: "20260520", amt: 900, narr: "" }], [{ ledger: "PF PAYABLE", date: "20260414", amt: 20000, ref: "1234567890123" }]);
ok(dd.pays.length === 2 && dd.pays.some((p) => p.date === "20260414") && !dd.pays.some((p) => p.date === "20260415"), "a March challan and its April bank entry (same ledger, amount, 1 day apart) count once, at the challan's date");
ok(pfDedup([{ ledger: "PF PAYABLE", date: "20260430", amt: 20000, narr: "TRRN 1234567890123" }], [{ ledger: "PF PAYABLE", date: "20260414", amt: 20000, ref: "1234567890123" }]).pays.length === 1, "matched by the TRRN in the narration though 16 days apart");
ok(dues43B([{ ledger: "PF PAYABLE", closing: 20000, charge: 20000 }], dd.pays, "20260831", "20260930", { pf: 1 })[0].paid === 20000, "the PF dues paid once (20,000), not twice (40,000)");
// payment dates not shown in the books: asked item by item, and the answer changes the computation
const bu = [{ ledger: "BONUS PAYABLE", closing: 50000, charge: 50000 }];
ok(dues43B(bu, [], "20260831", "20260630", {})[0].unknown, "books ending before the due date: the payment date is unknown");
ok(S("43b") === "matched" && base.by("43b").kind === "consistency", "43B: the demo's dues all paid in April 2026: Matched, labelled a consistency check");
r = run({ dues43B: d1, state: { adjEdits: { "43b": { v: 0, why: "planted" } } } });
ok(r.by("43b").status === "difference" && r.by("43b").diff === -47500, "43B: the return's add-back edited to 0 against 47,500 from the books: Difference -47,500");
r = run({ dues43B: d1 });
ok(r.by("43b").status === "matched" && r.comp.lines.find((l) => l.key === "add:43b").amt === 47500, "43B from the books' dues: 47,500 added back, Matched");
r = run({ dues43B: dues43B(bu, [], "20260831", "20260630", {}) });
ok(r.by("43b_unknown").status === "needs" && r.by("43b_unknown").noAccept && r.by("43b_unknown").ask.length === 1 && !r.comp.lines.some((l) => l.key === "add:43b"), "43B: a payment date not known: asked per item, cannot be accepted with a note, nothing added yet");
r = run({ dues43B: dues43B(bu, [], "20260831", "20260630", {}), state: { paidOn: { "43b:BONUS PAYABLE": "20260815" } } });
ok(r.by("43b_unknown").status === "absent" && !r.comp.lines.some((l) => l.key === "add:43b"), "answered: paid 15-08-2026 (by the due date): nothing added back, the question closes");
r = run({ dues43B: dues43B(bu, [], "20260831", "20260630", {}), state: { paidOn: { "43b:BONUS PAYABLE": "none" } } });
ok(r.comp.lines.find((l) => l.key === "add:43b").amt === 50000 && r.by("43b").status === "matched", "answered: not paid: 50,000 added back");
ok(settle43B(dues43B(bu, [], "20260831", "20260630", {}), { "43b:BONUS PAYABLE": "20260905" }, "20260831")[0].dis === 50000, "answered: paid after the due date: added back");
ok(S("43b_gst") === "absent", "GST / TDS payable paid in April: no question");
// the PF / ESI payments after the year end: the bank entries against the challans
r = run({ books: (b) => { b.pfProof = { books: 20000, challans: 19000, rows: [] }; } });
ok(r.by("43b_paid").status === "difference" && r.by("43b_paid").diff === 1000 && r.by("43b_paid").kind !== "consistency", "PF paid in April: bank entries 20,000 against challans 19,000: Difference 1,000 (an independent check)");
r = run({ books: (b) => { b.pfProof = { books: 20000, challans: null, rows: [] }; } });
ok(r.by("43b_paid").status === "missing", "no March challan: Missing data");
// earlier years' 43B paid this year
r = run({ books: (b) => { b.prior43B = [{ ledger: "BONUS PAYABLE", opening: 80000, paidInYear: 80000 }]; } });
ok(r.by("43b_prior").status === "needs" && r.by("43b_prior").noAccept && r.by("43b_prior").askAmount, "dues payable at 1-04-2025 and paid, last year's return not in FinCom: the amount asked (cannot be noted away)");
r = run({ books: (b) => { b.prior43B = [{ ledger: "BONUS PAYABLE", opening: 80000, paidInYear: 80000 }]; }, state: { prior43BPaid: 30000 } });
ok(r.by("43b_prior").status === "absent" && r.comp.lines.find((l) => l.key === "less:43b_prior").amt === 30000, "answered 30,000: allowed in the computation (AmtDisallUs43BNowAllow)");
r = run({ books: (b) => { b.prior43B = [{ ledger: "BONUS PAYABLE", opening: 80000, paidInYear: 60000 }]; }, prevState: { versions: [{ v: 3, dis43B: [{ ledger: "BONUS PAYABLE", amt: 50000 }] }] } });
ok(r.by("43b_prior").status === "absent" && r.comp.lines.find((l) => l.key === "less:43b_prior").amt === 30000, "last year's return in FinCom: 50,000 added back of an 80,000 balance; 60,000 paid: 30,000 allowed now (the 30,000 allowed last year paid first)");
// the third review (0610180ac): employees' PF / ESI ledgers by their usual names; admin charges and EDLI the employer's
const EE = ["EMPLOYEE PF PAYABLE", "EMPLOYEES PF PAYABLE", "EMPLOYEE'S CONTRIBUTION", "PF DEDUCTED", "PF (EMPLOYEE)", "EMPLOYEE ESI PAYABLE", "EMPLOYEES ESI PAYABLE", "EMPLOYEE'S CONTRIBUTION TO ESI", "ESI DEDUCTED", "ESI (EMPLOYEE)", "EMPLOYEES' CONTRIBUTION TO ESIC"];
const badEE = EE.filter((l) => { const k = kind43B(l); return !k || k.role !== "ee" || k.on; });
ok(!badEE.length, "employees' PF / ESI ledgers by their usual names: 36(1)(va) only, never 43B" + (badEE.length ? ": " + badEE.join(", ") : ""));
ok(kind43B("EMPLOYEE'S CONTRIBUTION TO ESI").kind === "esi" && kind43B("PF (EMPLOYEE)").kind === "pf", "the fund read from the name (ESI / PF)");
const ADM = ["PF ADMIN CHARGES PAYABLE", "EDLI PAYABLE", "EDLI CHARGES PAYABLE", "PF ADMINISTRATION CHARGES"];
const badAdm = ADM.filter((l) => { const k = kind43B(l); return !k || k.kind !== "pf" || k.role !== "er" || !k.on; });
ok(!badAdm.length, "PF admin charges and EDLI: the employer's, under 43B" + (badAdm.length ? ": " + badAdm.join(", ") : ""));
ok(kind43B("EMPLOYEES' PROVIDENT FUND PAYABLE").role === "" && kind43B("EMPLOYEES STATE INSURANCE PAYABLE").role === "", "the schemes' own names (Employees' Provident Fund, Employees' State Insurance) stay ledgers for both");
ok(dues43B([{ ledger: "EMPLOYEE PF PAYABLE", closing: 50000, charge: 50000 }], [], "20260831", "20260930", { pf: 0.5 })[0].dis === 0, "an employees' PF ledger with 50,000 unpaid: nothing added back under 43B");
const adm = dues43B([{ ledger: "PF ADMIN CHARGES PAYABLE", closing: 4000, charge: 4000 }], [], "20260831", "20260930", { pf: 0.5 })[0];
ok(adm.dis === 4000 && adm.part === 1 && !adm.unknownShare, "PF admin charges unpaid: 4,000 in full, never split by the ECR");
// PF / ESI by wage month; an old balance not reduced in the year is asked, never added back
const pfc = dues43B([{ ledger: "PF PAYABLE", opening: 300000, charge: 1200000, closing: 300000, minBal: 200000 }], [{ ledger: "PF PAYABLE", date: "20260410", amt: 100000, ym: "202603" }], "20260831", "20260930", { pf: 0.55 })[0];
ok(pfc.dis === 0 && pfc.stale === 200000, "the reviewer's case: PF payable, 2 lakh of stale arrears, 12 lakh charged, 3 lakh at the year end, March's 1 lakh paid 10-04: nothing added back; the 2 lakh asked");
const pfn = dues43B([{ ledger: "PF PAYABLE", opening: 300000, charge: 1200000, closing: 300000, minBal: 200000 }], [], "20260831", "20260930", { pf: 1 })[0];
ok(pfn.dis === 100000 && pfn.stale === 200000, "the same, March not paid: only March's 1 lakh added back (of this year's charge), the arrears still asked, not added");
const pfa = dues43B([{ ledger: "PF PAYABLE", opening: 300000, charge: 1200000, closing: 300000, minBal: 200000 }], [{ ledger: "PF PAYABLE", date: "20260410", amt: 100000, ym: "202603" }, { ledger: "PF PAYABLE", date: "20260520", amt: 200000, ym: "202405" }], "20260831", "20260930", { pf: 1 })[0];
ok(pfa.dis === 0 && pfa.stale === 0, "a challan for an old wage month (May 2024) settles the arrears: no question left");
const bst = dues43B([{ ledger: "BONUS PAYABLE", opening: 50000, charge: 40000, closing: 90000, minBal: 50000 }], [], "20260831", "20260930", {})[0];
ok(bst.dis === 40000 && bst.stale === 50000, "bonus: last year's 50,000 never reduced in the year: asked (not added back); this year's 40,000 unpaid added back");
const bsp = dues43B([{ ledger: "BONUS PAYABLE", opening: 50000, charge: 40000, closing: 90000, minBal: 50000 }], [{ ledger: "BONUS PAYABLE", date: "20260601", amt: 60000 }], "20260831", "20260930", {})[0];
ok(bsp.dis === 30000 && bsp.stale === 0, "bonus, the fallback (oldest first): 60,000 paid in June settles the old 50,000, then 10,000 of the year's charge: 30,000 added back");
r = run({ dues43B: [pfc] });
ok(r.by("43b_stale").status === "needs" && !r.by("43b_stale").noAccept && /already disallowed/i.test(r.by("43b_stale").how) && !r.comp.lines.some((l) => l.key === "add:43b"), "the stale arrears question shown on Checks (answered with a note); the add-back 0");
// earlier years' 43B(h): matched by the bill, never by the party's name alone
r = run({ books: (b) => { b.prior43B = []; b.msme = Object.assign({}, b.msme, { priorPaid: [{ party: "G", ref: "7", date: "20250220", amt: 5000 }, { party: "G", ref: "8", date: "20250301", amt: 9000 }] }); },
  prevState: { versions: [{ v: 2, dis43B: [{ msme: true, party: "G", ref: "7", date: "20250220", amt: 5000 }, { msme: true, party: "G", ref: "9", date: "20250310", amt: 4000 }] }] } });
ok(r.comp.lines.find((l) => l.key === "less:43b_prior").amt === 5000, "last year's 43B(h) bills: bill 7 paid this year allowed (5,000); bill 9 not paid, and bill 8 (not added back last year) of the same party, not allowed");
const m1 = msme43Bh([{ party: "A", ref: "1", date: "20260201", amt: 10000, paidOn: "20260410" }, { party: "B", ref: "2", date: "20260320", amt: 20000, paidOn: "20260415" }, { party: "C", ref: "3", date: "20260325", amt: 30000, paidOn: "20260520" },
  { party: "D", ref: "4", date: "20260328", amt: 40000, paidOn: "" }], 45, "20260331", "20260630");
ok(m1.rows.map((x) => x.party).join("") === "ACD" && !m1.rows.some((x) => x.party === "B"), "43B(h), 45 days: overdue at 31 March (A), paid after its limit in May (C) and unpaid past its limit (D) added back; paid within (B) allowed");
ok(msme43Bh([{ party: "E", ref: "5", date: "20260325", amt: 1, paidOn: "" }], 15, "20260331", "20260331").unknown.length === 1, "43B(h): a limit after the books end: Needs you");
ok(msme43Bh([{ party: "F", ref: "6", date: "20260320", amt: 1, paidOn: "20260404" }], 15, "20260331", "20260930").rows.length === 0, "43B(h), 15 days (no agreement): paid on day 15: allowed");
ok(S("43bh") === "matched" && base.by("43bh").kind === "consistency", "43B(h) in the demo: both MSME bills paid within 45 days (a consistency check)");
ok(msme43Bh([{ party: "G", ref: "7", date: "20250220", amt: 5000, paidOn: "" }], 45, "20260331", "20260930", "20250401").rows.length === 0, "43B(h): a bill of last year is not this year's add-back");
const ff = msmeFifo({ M1: { opening: 0, moves: [{ date: "20260201", amt: 10000 }, { date: "20260320", amt: 20000 }, { date: "20260310", amt: -10000 }, { date: "20260420", amt: -20000 }] } }, 45, "20250401", "20260331", "20260930");
ok(ff.rows.length === 0, "the vouchers' way: the February bill paid in March, the March bill paid on 20 April within 45 days: nothing added");
const ms2 = { rows: [], unknown: [{ id: "43bh:Z|9|20260325", party: "Z", ref: "9", date: "20260325", amt: 7000, limit: "20260409" }], days: 15, fifo: null };
r = run({ msme: ms2 });
ok(r.by("43bh_unknown").noAccept && r.by("43bh_unknown").ask[0].id === "43bh:Z|9|20260325" && !r.comp.lines.some((l) => l.key === "add:43bh"), "43B(h): a bill due after the books end: asked, nothing added yet");
r = run({ msme: ms2, state: { paidOn: { "43bh:Z|9|20260325": "20260415" } } });
ok(r.comp.lines.find((l) => l.key === "add:43bh").amt === 7000, "answered: paid 15-04 after its limit of 09-04: 7,000 added back");
r = run({ msme: ms2, state: { paidOn: { "43bh:Z|9|20260325": "20260405" } } });
ok(!r.comp.lines.some((l) => l.key === "add:43bh") && r.by("43bh_unknown").status === "absent", "answered: paid within the limit: allowed");
r = run({ msme: Object.assign({}, ms2, { unknown: [], rows: [{ party: "Y", ref: "1", date: "20260101", amt: 4000, limit: "20260215" }], fifo: { amt: 0, unknown: 0, n: 0 } }) });
ok(r.by("43bh_fifo").status === "difference" && r.by("43bh_fifo").diff === 4000, "43B(h): the bill references (4,000 late) against the payment vouchers (nothing late): Difference");
ok(tallyPbt({ SALES: -1000, PURCHASES: 700, RENT: 100, BANK: 50 }, (l) => ({ SALES: "SALES ACCOUNTS", PURCHASES: "PURCHASE ACCOUNTS", RENT: "INDIRECT EXPENSES", BANK: "BANK ACCOUNTS" }[l]), { opening: 100, closing: 150 }) === 250, "Tally's own P&L: revenue groups only, with the stock (1,000 - 700 - 100 + 50 = 250)");
console.log("3CD against the ITR's schedules");
r = run({ state: { audit: true } });
ok(r.by("3cd").status === "missing", "a tax audit and no saved Audit run: Missing data");
r = run({ state: { audit: true }, form3cd: [{ clause: "21(b)(ii)(A)", what: "sums without TDS", amt: 120000, itrBase: 120000, itrSrc: "BP" }, { clause: "21(d)(A)", what: "cash", amt: 20000, itrKey: "add:40a3", itrSrc: "BP 40A(3)" }] });
ok(r.by("3cd_21(b)(ii)(A)").status === "matched" && r.by("3cd_21(d)(A)").status === "difference" && r.by("3cd_21(d)(A)").diff === 1500, "3CD 21(d) cash 20,000 against the return's 18,500: Difference 1,500");
console.log("the computation");
ok(S("two_computations") === "matched", "two computations agree");
r = run({ comp: (c) => { c.key = Object.assign({}, c.key, { liability: c.key.liability + 1 }); } });
ok(r.by("two_computations").status === "difference" && r.by("two_computations").noAccept, "a rupee apart: Difference, never accepted");
r = run({ state: { regime: "" } }); ok(r.by("need_regime").noAccept, "no regime: settled only on Data");
r = run({ model: (m) => { m.cg = { s111A: 80000 }; } });
ok(r.by("87a_special").status === "absent", "87A with special-rate income: the owner's reading (22-11-2026), no question");
r = run({ entity: "F", state: { form: "ITR-5", llp: undefined } }); ok(r.by("llp").status === "needs" && r.by("llp").noAccept, "a firm: firm or LLP asked (never from the name)");
r = run({ entity: "C", state: { form: "ITR-6", regime: "normal", smallCo: undefined } }); ok(r.by("need_small_co").noAccept && r.by("rates").status === "needs", "a company: the FY 2023-24 turnover asked; blocks");
r = run({ coverage: [{ key: "hp", title: "Schedule HP", text: "House property income of 1,20,000: Schedule HP is not filled by FinCom yet." }] });
ok(r.by("cover_hp").status === "needs" && r.by("cover_hp").noAccept, "a schedule with figures FinCom does not map blocks the JSON");
console.log("acceptances bound to the figures; the gate");
const ok1 = { ok: true, errors: [] };
ok(!gate(base.cs, ok1).ok, "checks open: the JSON is not offered (" + gate(base.cs, ok1).open.length + ")");
const acc = {}; base.cs.filter((c) => c.status !== "matched" && !c.noAccept).forEach((c) => { acc[c.id] = { note: "made-up reason", fp: c.fp, at: "2026-11-22", by: "Owner" }; });
r = run({ accepted: acc });
ok(gate(r.cs, ok1).ok, "every open check accepted or answered with a note: offered");
const r2 = run({ accepted: acc, state: { osInterest: 1000 } });
ok(r2.by("ais_interest").lapsed && !r2.by("ais_interest").accepted && !gate(r2.cs, ok1).ok, "the interest difference changed (8,400 -> 7,400): its acceptance lapses, the JSON is blocked again");
ok(fingerprint({ status: "difference", diff: 5, a: { amt: 1, src: "x" }, b: { amt: -4, src: "y" } }) !== fingerprint({ status: "difference", diff: 5, a: { amt: 2, src: "x" }, b: { amt: -3, src: "y" } }), "the fingerprint covers both sides, not only the difference");
ok(!gate(r.cs, null).ok, "the schema not loaded: not offered");
const r3 = run({ accepted: acc, comp: (c) => { c.key = Object.assign({}, c.key, { cess: c.key.cess + 1 }); } });
ok(!gate(r3.cs, ok1).ok, "the computations apart: not offered");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
