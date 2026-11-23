// node tests/run_payroll_review.mjs - the independent review of FinCom Payroll -> Tally Payroll (next-payroll), on
// made-up books only. Unlike run_payroll_post.mjs, nothing of the second check is stubbed here: the night's builder
// (server/_shared/dailyjournals.js payrollOne, through nightInput as assistant-night runs it) and the page's second check
// (app/src/screens/daily/again.js recheck, on the books as the browser opens them) run for real; only the bridge, the
// cloud's functions and the drafts' store are faked.
//   B1  a month already entered in Tally Payroll by hand (a payroll voucher to "Basic Pay"): never posted twice
//   B2  the split fixed by Tally's employee list (a re-sorted sheet moves nobody); a part in Tally that differs: refused
//   B3  a split month with part 1 in the books: still the night's entry, only part 2 posted
//   the owner's "Night prepares every month": a Tally Payroll company's month with other deductions (an advance) and no
//   journal ledgers picked is a ready entry; 2 the bridge asked is the cloud's when the books are in the cloud; 3 the
//   payable ledger and voucher type kept on the client; 4 a cost category per employee (a part a category); 6 alreadySent
//   / already in Tally; 7 a month kept for 24Q replaced without losing its tax figures; 8 the AI's samples masked, the
//   tab's month left out of the layout's key; lows: the page closed between parts, a net of zero, two Tally employees
//   whose names fold to one
import { booksOf, gstOf, nightInput, draftsOf } from "../server/assistant-night/nightinput.js";
import { journals, payrollOne, draftState } from "../server/_shared/dailyjournals.js";
import * as E from "../server/_shared/gst3b.js";
import * as TP from "../app/src/lib/tallyPayroll.js";
import * as TPost from "../app/src/lib/payrollPost.js";
import * as PS from "../app/src/lib/payrollSheet.js";
import { gstRows, head, L } from "./daily2_books.mjs";

let fails = 0, n = 0;
const ok = (c, w) => { n++; console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const TODAY = "20261122", YM = "202610";
const r2 = (x) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------- the made-up client
// employees: {name, earn: {Basic, HRA}, tds, pt, pf, esi, adv (an advance recovered: another deduction)}
const emp = (name, basic, hra, o = {}) => {
  const earn = { Basic: basic, HRA: hra }, gross = r2(basic + hra), ded = o.adv ? { "Advance Recovery": o.adv } : {}, other = o.adv || 0;
  return { name, month: YM, date: "2026-10-31", earn, ded, otherDed: other, gross, tds: o.tds || 0, profTax: o.pt || 0, pf: o.pf || 0, esi: o.esi || 0, net: r2(gross - (o.tds || 0) - (o.pt || 0) - (o.pf || 0) - (o.esi || 0) - other) };
};
const SHEET = [emp("Ravi Kumar", 25000, 10000, { tds: 2500, pt: 200, pf: 1800 }), emp("Asha Verma", 15000, 6000, { pt: 200, pf: 1800, esi: 188, adv: 2000 }), emp("Mehta, Sunil", 6774.19, 2709.68, { pf: 813, esi: 82 })];
const many = (k) => Array.from({ length: k }, (_, i) => emp("Made Up Person " + String(i).padStart(3, "0"), 10000, 2000, { pt: 200 }));
const PAYHEADS = { "Basic Pay": "Indirect Expenses", "HRA": "Indirect Expenses", "Income Tax": "Duties & Taxes", "Professional Tax": "Duties & Taxes", "PF Employee 12%": "Duties & Taxes",
  "ESI Employee": "Duties & Taxes", "Advance Recovery": "Loans & Advances (Asset)", "Salary Payable": "Provisions" };
const HEADS = { "Basic Pay": { type: "Earnings for Employees" }, "HRA": { type: "Earnings for Employees" }, "Income Tax": { type: "Deductions from Employees", stat: "Income Tax" },
  "Professional Tax": { type: "Deductions from Employees", stat: "Professional Tax" }, "PF Employee 12%": { type: "Employees' Statutory Deductions", stat: "PF Account (A/c No. 1)" },
  "ESI Employee": { type: "Employees' Statutory Deductions", stat: "Employee State Insurance" }, "Advance Recovery": { type: "Loans and Advances" }, "Salary Payable": { type: "" } };
const PLAN = { "earn:Basic": "Basic Pay", "ded:Advance Recovery": "Advance Recovery" };
const CO = (o = {}) => Object.assign({ id: "c1", name: "Sample Traders", closed: {}, payrollMethod: { value: "tally", by: "Made-up Owner" }, payHeadPlan: PLAN, payrollPayable: "Salary Payable" }, o);
// the cloud rows: GST months as daily2_books makes them, the salary sheet kept with the books, the payroll's ledgers
function rowsOf(o = {}) {
  const rows = gstRows({ ym: YM, intra: 100000, buyIntra: 40000, extraLedgers: Object.assign({}, PAYHEADS, o.ledgers || {}), drop: o.drop || [], items: [{ key: "salary", item: "", ord: 0, data: o.sheet || SHEET, deleted: false }] });
  rows.co = CO(o.co);
  (o.vouchers || []).forEach((v) => { rows.heads.push(head(v.guid, v.day, v.type, "", { narration: v.narr || "" })); v.lines.forEach(([l, a]) => rows.lines.push(L(v.guid, l, a))); });
  return rows;
}
// tonight, as assistant-night runs it (the client's settings from its record; the pay heads read with for_payroll)
function night(rows, o = {}) {
  const b = booksOf(rows);
  const inp = nightInput(rows, b, { today: TODAY, bankRecs: [], inboxRecs: [], entryRecs: [], twob: [], gst: gstOf(rows, b, TODAY), prior: [], draftRecs: o.draftRecs || [], jobs: {}, payHeads: o.payHeads === undefined ? Object.keys(PAYHEADS) : o.payHeads });
  const j = journals(inp);
  return { entry: j.entries.find((e) => e.source === "payroll"), finding: j.findings.find((f) => f.kind === "payroll_due"), inp };
}
// Tally's payroll as FinCom read it (Payroll.data(): the employees, the pay heads, the entries' allocations)
const payOf = (sheet, o = {}) => ({ employees: (o.emps || sheet.map((r) => ({ name: r.name }))).map((e, i) => Object.assign({ guid: "e" + i, category: "" }, e)), heads: HEADS, allocs: o.allocs || [], vouchers: o.pv || {} });
// a part posted in Tally as the bridge puts it there: a payroll voucher carrying FinCom's id, its allocations
function inTally(v, guid) {
  const lines = [], allocs = [];
  const by = {}; v.employees.forEach((e) => e.heads.forEach((h) => { by[h.head] = r2((by[h.head] || 0) + h.amount); allocs.push({ guid, day: "20261031", head: h.head, employee: e.name, amt: h.amount }); }));
  Object.entries(by).forEach(([h, a]) => lines.push([h, a]));
  lines.push([v.payable, v.net]);
  return { voucher: { guid, day: "2026-10-31", type: "Payroll", narr: v.narration + " | TDSDesk:" + v.id, lines }, allocs, pv: { [guid]: { day: "20261031", type: "Payroll", no: "7" } } };
}

// ---------------------------------------------------------------- the browser: S.books, CO(), Approve with the real recheck
function world(rows, o = {}) {
  const log = [], drafts = o.drafts || {}, posts = [], b = booksOf(JSON.parse(JSON.stringify(Object.assign({}, rows, { made: undefined }))));
  b.payroll = payOf(o.sheet || SHEET, o);
  const A = {
    postGate: () => ({ ok: true }), postCompany: () => "ZZ Made Up Traders", me: () => "Made-up Person", plainWhy: (m) => String(m || "").replace(/^Failed:\s*/, ""),
    tallyIdOf: (x) => String(x.vchId || ""), clientLedgers: async () => rows.ledgers.map((l) => ({ name: l.name })),
    Drafts: { get: (cid, id) => drafts[id] || null, load: async () => Object.values(drafts), save: async (cid, d, what) => { drafts[d.id] = JSON.parse(JSON.stringify(d)); log.push("save " + d.id + " " + d.state); return true; } },
  };
  const answer = o.answer || ((v) => ({ id: v.id, ok: true, created: 1, vchId: String(100 + posts.length), word: "In Tally" }));
  const g = { tallyVia: () => "bridge", Bridge: { st: { version: "2.5.18" }, post: async (pl) => { posts.push(pl); log.push("post " + pl.vouchers[0].id); return { ok: true, results: [answer(pl.vouchers[0], posts.length)] }; } },
    TCloud: { on: () => true, has: () => false }, Cloud: { api: async () => [] } };
  const rpc = async (fn) => { log.push(fn); return { ok: true }; };
  const env = { g, A, rpc, co: rows.co, books: b, pay: b.payroll, bookId: "b1", jobs: {}, prior: [] };
  const run = async (e) => {
    Object.assign(globalThis, { S: { books: b, coId: "c1", companies: { c1: rows.co } }, CO: () => rows.co, GSTR: E.GSTR, GSTF: E.GSTF, GSTSet: E.GSTSet, Books: E.Books, ledGroupPath: E.ledGroupPath });
    try { return await TPost.approveTallyPayroll(Object.assign({ id: "n1", client_id: "c1", state: "ready" }, e), env); }
    finally { ["S", "CO", "GSTR", "GSTF", "GSTSet", "Books", "ledGroupPath"].forEach((k) => delete globalThis[k]); }
  };
  return { log, drafts, posts, env, b, run };
}
const asRecs = (drafts) => Object.values(drafts).map((d) => ({ item: "#" + d.id, data: d, updated_at: new Date().toISOString() }));

console.log("the owner's decision: Night prepares every month (a Tally Payroll company)");
{
  const t = night(rowsOf());
  const v = (t.entry || {}).voucher || {};
  ok(t.entry && t.entry.ready && v.kind === "tallyPayroll" && v.type === "Payroll" && v.party === "Salary Payable" && v.n === 3, "a month with an advance recovered: a ready Tally Payroll entry (3 employees, net to Salary Payable)");
  const gross = SHEET.reduce((s, r) => s + r.gross, 0), net = SHEET.reduce((s, r) => s + r.net, 0);
  ok(Math.round(v.gross * 100) === Math.round(gross * 100) && Math.round(v.net * 100) === Math.round(net * 100) && v.ded.other === 2000 && !(v.lines || []).length, "  its totals: gross, net, the advance as other deductions (" + v.ded.other + "); no journal lines");
  ok(t.entry.checks.every((c) => c.ok) && t.entry.checks.some((c) => c.k === "twoways") && t.entry.checks.some((c) => c.k === "period"), "  worked out two ways; the period open");
  const noPick = night(rowsOf({ co: { payrollPayable: "" }, drop: ["TDS on Salary 192"] }));
  ok(noPick.entry && noPick.entry.ready && noPick.entry.voucher.party === "Salary Payable", "no ledger picked on Payroll: the payable found by name and group; no TDS, PT, PF or ESI ledger needed");
  const none = night(rowsOf({ co: { payrollPayable: "" }, drop: ["Salary Payable"] }));
  ok(none.entry && none.entry.ready && none.entry.voucher.party === "", "no salary payable ledger at all: still prepared, totals only (Approve asks for the ledger on Payroll)");
  const nov = night(rowsOf({ sheet: SHEET.concat(SHEET.map((r) => Object.assign({}, r, { month: "202609", date: "2026-09-30" }))) }));
  ok(journals(nov.inp).entries.filter((e) => e.source === "payroll").length === 2, "every month kept with the books: September and October both prepared");
  const j = night(rowsOf({ co: { payrollMethod: { value: "journal" } } }));
  ok(!j.entry && /other deductions \(Advance Recovery\) have no ledger in the payroll journal/.test(j.finding.facts.title), "a journal company with an advance: no journal; said plainly (book it by hand, or Tally Payroll)");
  const once = night(rowsOf({ co: { payrollJournal: { [YM]: { by: "x" } } } }));
  ok(!once.entry, "a Tally Payroll company that chose a journal this month: the journal path (and its rules) instead");
  const z = night(rowsOf({ sheet: [SHEET[0], Object.assign({}, SHEET[2], { pf: 0, esi: 0, earn: { Basic: 0, HRA: 0 }, gross: 500, tds: 0, profTax: 500, net: 0 })] }));
  ok(!z.entry && /Mehta, Sunil's net pay is ₹0\. Tally Payroll can't take an employee with nothing to pay/.test(z.finding.facts.title), "low: an employee with a net of zero: said plainly tonight, before anything is posted");
}

console.log("B1: a month already entered in Tally Payroll by hand");
{
  const gross = r2(SHEET.reduce((s, r) => s + r.gross, 0));
  const hand = (amt, more = {}) => Object.assign({ guid: "hand1", day: "2026-10-31", type: "Payroll", narr: "Salary Oct", lines: [["Basic Pay", -r2(amt * 0.7)], ["HRA", -r2(amt - r2(amt * 0.7))], ["Salary Payable", amt]] }, more);
  let t = night(rowsOf({ vouchers: [hand(gross)] }));
  ok(!t.entry && !t.finding, "a hand payroll voucher to Basic Pay and HRA for the same gross: salary booked, nothing prepared (never twice)");
  t = night(rowsOf({ vouchers: [hand(50000)] }));
  ok(!t.entry && /salary booked ₹50,000, the sheet says/.test(t.finding.facts.title), "  for another amount: Needs you, the amounts said");
  t = night(rowsOf({ vouchers: [hand(gross, { type: "Salary Voucher", lines: [["Basic Pay", -gross], ["Salary Payable", gross]] })] }), { payHeads: [] });
  ok(!!t.entry, "  (a voucher to a ledger FinCom can't tell is payroll, of another type: not taken for salary)");
  t = night(rowsOf({ vouchers: [hand(gross, { lines: [["Staff Welfare", -gross], ["Salary Payable", gross]] })], ledgers: { "Staff Welfare": "Indirect Expenses" } }), { payHeads: [] });
  ok(!t.entry && !t.finding, "  a voucher of the Payroll type: counted whatever its ledgers are named, even before the pay heads are read");
  // Approve: the hand voucher entered in Tally after the night prepared the month
  const rows = rowsOf(), e = night(rows).entry;
  const later = rowsOf({ vouchers: [hand(gross)] }), w = world(later, { allocs: [{ guid: "hand1", day: "20261031", head: "Basic Pay", employee: "Ravi Kumar", amt: -1000 }], pv: { hand1: { day: "20261031", type: "Payroll", no: "12" } } });
  const r = await w.run(e);
  ok(!r.ok && !w.posts.length && !w.log.includes("entry_claim"), "Approve after a hand payroll voucher was entered: refused, nothing claimed or sent (" + r.why + ")");
  const p = TPost.prepare({ co: rows.co, ym: YM, rows: SHEET, pay: w.b.payroll, ledgers: rows.ledgers.map((l) => l.name), books: w.b });
  ok(!p.vouchers.length && /Tally already has a payroll entry for Oct 2026 that FinCom did not post \(Payroll no\. 12 31-10-2026\)/.test(p.problems[0]), "  the page's own guard (Payroll.data's entries without FinCom's id): " + p.problems[0]);
}

console.log("B3 and B2: a split month, part 1 in Tally, then the rest");
{
  const sheet = many(150), rows = rowsOf({ sheet }), t = night(rows);
  ok(t.entry && t.entry.ready && t.entry.voucher.n === 150, "150 employees: one night entry");
  let first = true;
  const w = world(rows, { sheet, answer: (v, k) => (v.id.endsWith("-2") && first ? { id: v.id, ok: false, message: "Voucher type 'Payroll' does not exist" } : { id: v.id, ok: true, created: 1, vchId: "2" + k }) });
  let r = await w.run(t.entry);
  ok(!r.ok && w.posts.map((p) => p.vouchers[0].id).join() === "dc-tp-202610-1,dc-tp-202610-2" && w.log.includes("entry_release"), "the real second check passes; part 1 posted, part 2 refused, released");
  const after1 = w.log.slice(w.log.indexOf("post dc-tp-202610-1") + 1);
  ok(after1[0] === "save dc-tp-202610-1 posted" && after1[1] === "save dc-tp-202610-2 waiting", "low: after part 1, part 2 is saved again (waiting): the latest draft is never a posted part while one is to go");
  ok(draftState({ vid: "dc-tp-202610-2", dedupe: "payroll:202610", state: "waiting", results: w.drafts["dc-tp-202610-2"].results }, {}, Date.now()) === "failed", "  so the cloud's settle (the latest draft) sends the entry back to ready, never to approved");
  // the books synced: part 1 is in Tally (FinCom's id in its narration, its allocations in Tally's payroll read)
  const p1 = TPost.prepare({ co: rows.co, ym: YM, rows: sheet, pay: w.b.payroll, ledgers: rows.ledgers.map((l) => l.name), books: w.b }).vouchers[0], x = inTally(p1, "tp1");
  const synced = rowsOf({ sheet, vouchers: [x.voucher] });
  const t2 = night(synced, { draftRecs: asRecs(w.drafts) });
  ok(t2.entry && t2.entry.ready && JSON.stringify(t2.entry.voucher) === JSON.stringify(t.entry.voucher), "tonight with part 1 in the books: the very same entry (its own part is not salary booked by hand)");
  const w2 = world(synced, { sheet, drafts: w.drafts, allocs: x.allocs, pv: x.pv });
  first = false;
  w2.env.g.Bridge.post = w.env.g.Bridge.post; w2.posts.push = (...a) => w.posts.push(...a);
  r = await w2.run(t.entry);
  ok(r.ok && w.posts.length === 3 && w.posts[2].vouchers[0].id === "dc-tp-202610-2" && /Part 1 of 2: Tally created 1/.test(r.words) && /Part 2 of 2: Tally created 1/.test(r.words), "Approve again with part 1 in the books: the second check passes, only part 2 is sent");
  const t3 = night(synced, { draftRecs: asRecs(w2.drafts) });
  ok(!t3.entry && !t3.finding, "both parts posted: the month is done (nothing prepared again)");
  // B2: the sheet sorted another way moves nobody between parts
  const rev = TPost.prepare({ co: rows.co, ym: YM, rows: sheet.slice().reverse(), pay: w.b.payroll, ledgers: rows.ledgers.map((l) => l.name), books: w.b });
  const fwd = TPost.prepare({ co: rows.co, ym: YM, rows: sheet, pay: w.b.payroll, ledgers: rows.ledgers.map((l) => l.name), books: w.b });
  ok(rev.vouchers.map(TP.payrollVoucherXml).join("") === fwd.vouchers.map(TP.payrollVoucherXml).join(""), "B2: the sheet re-sorted: the same parts, byte for byte (Tally's employee order)");
  // a part in Tally that is not the part built now (an employee moved between parts): refused, nothing sent
  const odd = JSON.parse(JSON.stringify(w.drafts)); odd["dc-tp-202610-1"].vouchers[0].xml = odd["dc-tp-202610-1"].vouchers[0].xml.replace("Made Up Person 000", "Made Up Person 149");
  delete odd["dc-tp-202610-2"];
  const w3 = world(synced, { sheet, drafts: odd, allocs: x.allocs, pv: x.pv });
  r = await w3.run(t.entry);
  ok(!r.ok && /^Part 1 in Tally differs from the sheet now/.test(r.why) && !w3.posts.length && !w3.log.includes("entry_claim"), "B2: a part in Tally that differs from the part built now: refused, nothing claimed or sent");
}

console.log("2, 3, 4, 6: the bridge asked, the payable and type, cost categories, alreadySent");
{
  const g = { tallyVia: () => "bridge", Bridge: { st: { version: "2.5.17" } }, TCloud: { on: () => true, has: (id) => id === "c1", postThrough: () => ({ version: "2.5.18", computer: "MADEUP-PC", user: "maker" }) } };
  const pb = TPost.postingBridge({ id: "c1" }, g);
  ok(pb.version === "2.5.18" && pb.where === "MADEUP-PC · maker", "2: books in the cloud: the queue's bridge is asked, though this computer has a bridge (as Bridge.post routes it)");
  ok(TPost.postingBridge({ id: "c2" }, g).version === "2.5.17", "  books not in the cloud: the bridge on this computer");
  const rows = rowsOf({ co: { payrollVchType: "Salary Payroll", payrollPayable: "Staff Salary Payable" }, ledgers: { "Staff Salary Payable": "Provisions" } }), t = night(rows);
  ok(t.entry && t.entry.voucher.type === "Salary Payroll" && t.entry.voucher.party === "Staff Salary Payable", "3: the payable ledger and voucher type picked on Payroll: the night's entry names them");
  const p = TPost.prepare({ co: rows.co, ym: YM, rows: SHEET, pay: payOf(SHEET), ledgers: rows.ledgers.map((l) => l.name), books: {} });
  ok(p.vouchers.length === 1 && p.vouchers[0].type === "Salary Payroll" && p.vouchers[0].payable === "Staff Salary Payable" && /VCHTYPE="Salary Payroll"/.test(TP.payrollVoucherXml(p.vouchers[0])), "  and the voucher posted with them");
  ok(TPost.vchTypesOf({ vouchers: { a: { type: "Salary Payroll" }, b: { type: "Payment" } } }, { vouchers: [{ type: "Payroll (Staff)" }] }).join() === "Payroll,Payroll (Staff),Salary Payroll", "  the types offered: Payroll and the payroll types the books carry");
  const w = world(rows); delete rows.co.payrollPayable; rows.co.payrollPayable = "Salary Payable";
  const r = await w.run(t.entry);
  ok(!r.ok && r.why === TPost.CHANGED && !w.posts.length, "  the payable picked again since the night: changed, nothing sent");
  // 4: employees under two cost categories: a part each (one CATEGORYENTRY a voucher, as the bridge's pin takes it)
  const emps = [{ name: "Ravi Kumar", category: "Head Office" }, { name: "Asha Verma", category: "" }, { name: "Mehta, Sunil", category: "Head Office" }];
  const c = TPost.prepare({ co: CO(), ym: YM, rows: SHEET, pay: payOf(SHEET, { emps }), ledgers: ["Salary Payable"], books: {} });
  ok(c.vouchers.length === 2 && c.vouchers[0].category === "Primary Cost Category" && c.vouchers[1].category === "Head Office" && c.vouchers[1].employees.map((e) => e.name).join() === "Ravi Kumar,Mehta, Sunil",
    "4: two cost categories: two parts, each employee under their own category");
  ok(c.vouchers.every((v) => TP.validatePayrollXml(TP.payrollVoucherXml(v)).length === 0) && /<CATEGORY>Head Office<\/CATEGORY>/.test(TP.payrollVoucherXml(c.vouchers[1])), "  each part the bridge's shape");
  // 6: the bridge's resend guard and "already in Tally": on its way / in Tally, never failed
  const rows6 = rowsOf(), e6 = night(rows6).entry;
  let w6 = world(rows6, { answer: (v) => ({ id: v.id, ok: false, alreadySent: true, sentJob: "job-77", message: "Already sent from this computer (job job-77): not sent again" }) });
  let r6 = await w6.run(e6);
  ok(r6.ok && r6.queued && /on its way to Tally \(sent before; not sent again\)/.test(r6.words) && !w6.log.includes("entry_release") && w6.drafts["dc-tp-202610-1"].job === "job-77", "6: alreadySent: on its way (its job kept), not failed, not released");
  w6 = world(rows6, { answer: (v) => ({ id: v.id, ok: false, message: "Already in Tally (voucher no. 41)" }) });
  r6 = await w6.run(e6);
  ok(r6.ok && /already in Tally \(not sent again\)/.test(r6.words) && w6.drafts["dc-tp-202610-1"].results["dc-tp-202610-1"].tallyId === "41", "  already in Tally (voucher no. 41): in Tally, with its number");
  w6 = world(rows6, { answer: (v) => ({ id: v.id, ok: true, existed: true, vchId: "42" }) });
  r6 = await w6.run(e6);
  ok(r6.ok && /already in Tally/.test(r6.words), "  existed: in Tally");
}

console.log("lows: two employees in Tally whose names fold to one");
{
  const v = TP.payrollVouchers({ id: "x", date: "2026-10-31", label: "Oct 2026", payable: "Salary Payable", rows: [SHEET[0]], plan: TP.payHeadPlan([SHEET[0]], HEADS, PLAN).plan, employees: [{ name: "Ravi-Kumar" }, { name: "RAVI KUMAR" }] });
  ok(!v.vouchers.length && /Two employees in Tally, “Ravi-Kumar” and “RAVI KUMAR”, match “Ravi Kumar”/.test(v.problems[0]), "two Tally employees match one sheet name: refused, never guessed");
  const v2 = TP.payrollVouchers({ id: "x", date: "2026-10-31", label: "Oct 2026", payable: "Salary Payable", rows: [SHEET[0]], plan: TP.payHeadPlan([SHEET[0]], HEADS, PLAN).plan, employees: [{ name: "Ravi Kumar" }, { name: "RAVI-KUMAR" }] });
  ok(v2.vouchers.length === 1 && v2.vouchers[0].employees[0].name === "Ravi Kumar", "  one of them exactly the sheet's name: that one");
}

console.log("7, 8, 9: the sheet kept, the AI's samples, the layout's key");
{
  const old = [Object.assign({}, SHEET[0], { code: "E1", pan: "ABCDE1234F", exempt: 12000, standard: 75000, chapter6: 50000, taxable: 300000, regime: "old" }), Object.assign({}, SHEET[1], { exempt: 0, regime: "new" })];
  const fresh = [Object.assign({}, SHEET[0], { code: "E1", pan: "" }), SHEET[1]];
  const w = PS.replacing(old, fresh);
  ok(w.n === 2 && w.tax === 2 && w.months.join() === YM, "7: replacing() says first: 2 employees kept for Oct 2026, 2 with 24Q's figures");
  const m = PS.mergeSalary(old, fresh), ravi = m.find((r) => r.name === "Ravi Kumar"), asha = m.find((r) => r.name === "Asha Verma");
  ok(ravi.exempt === 12000 && ravi.standard === 75000 && ravi.chapter6 === 50000 && ravi.taxable === 300000 && ravi.regime === "old" && ravi.pan === "ABCDE1234F" && asha.regime === "new" && m.length === 2,
    "  kept over a month read for 24Q: exemptions, standard deduction, Chapter VI-A, taxable, regime and PAN carried over by employee");
  const head = ["Emp Name", "Basic", "HRA", "Gross", "Net"];
  ok(PS.fingerprint(head, "Salary Oct 2026") === PS.fingerprint(head, "Salary November 2026") && PS.fingerprint(head, "SALARY-SEPT-26") === PS.fingerprint(head, "salary_jan_27") && PS.fingerprint(head, "Salary Oct") !== PS.fingerprint(head, "Bonus Oct"),
    "8: the tab's month left out of the layout's key (any case, short or full): a monthly tab reuses its rule");
  const legacy = { id: "r0", fp: "p" + "x", deleted: false };
  const oldFp = (() => { const names = head.map(PS.norm), sh = "salary oct #".replace(/\d+/g, "#").replace(/[^a-z#]+/g, ""); let h = 2166136261; const s = names.join("|") + "#" + names.length + "#" + sh; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return "p" + h.toString(36); })();
  legacy.fp = oldFp;
  ok(PS.findRule(head, "Salary Oct 2026", [legacy]) === legacy, "  a rule saved under the old key is still found");
  const sm = PS.samples(["Name", "DOB", "Month", "Account", "Days", "Basic", "Net"], [["Ravi Kumar", "12/03/1990", "Oct-2026", "1234 5678 9012", "30", "25,345.50", "48,712"], ["Asha", "1990-03-12", "10/2026", "50100012345", "26.5", "1354.84", "9876"]]);
  const r0 = sm.rows[0], r1 = sm.rows[1];
  ok(/^DATE_\d$/.test(r0[1]) && /^DATE_\d$/.test(r1[1]) && r0[2] === "Oct-2026" && r1[2] === "10/2026", "  a date of birth masked; the pay month kept");
  ok(/^NUMBER_\d$/.test(r0[3]) && /^NUMBER_\d$/.test(r1[3]), "  account numbers of 11 and 12 digits (spaced too) masked");
  ok(r0[4] === "30" && r1[4] === "26.5" && r0[5] === "25000" && r0[6] === "49000" && r1[5] === "1400" && r1[6] === "9900", "  the figures rounded (" + [r0[5], r0[6], r1[5], r1[6]].join(", ") + "); days kept");
  let S = null; try { S = await import("../server/assistant/sheetmap.ts"); } catch (e) { console.log("  (skipped: this Node cannot read TypeScript)"); }
  if (S) {
    const p = S.payrollPrompt(["Name", "DOB", "Account", "Basic"], [["TEXT_1", "12/03/1990", "123456789012", "25,345.50"]]);
    ok(/"DATE"/.test(p) && /"NUMBER"/.test(p) && /"25000"/.test(p) && /TEXT_1/.test(p) && !/1990|123456789012|25,345/.test(p), "  the server masks again whatever the page sent (sheetmap.ts payrollPrompt)");
  }
}

console.log("the drafts the night reads carry the parts");
{
  const d = draftsOf([{ item: "#dc-tp-202610-1", data: { id: "dc-tp-202610-1", dedupe: "payroll:202610", parts: 2, state: "posted", results: { "dc-tp-202610-1": { ok: true, tallyId: "9" } } } }], {}, [], Date.now());
  ok(d.length === 1 && d[0].parts === 2 && d[0].state === "posted", "nightinput draftsOf: a part's count of parts");
  const one = payrollOne(YM, SHEET, Object.assign({}, night(rowsOf()).inp, { drafts: [{ vid: "dc-tp-202610-1", dedupe: "payroll:202610", state: "live", parts: 1 }] }));
  ok(one === null, "a part on its way to Tally: nothing prepared tonight (waited for)");
}

console.log(fails ? "\n" + fails + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fails ? 1 : 0);
