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
import { booksOf, gstOf, nightInput, draftsOf, monthEndsIST, daysOfBooks } from "../server/assistant-night/nightinput.js";
import { journals, payrollOne, draftState } from "../server/_shared/dailyjournals.js";
import { earningHead } from "../server/_shared/nightchecks.js";
import * as E from "../server/_shared/gst3b.js";
import * as TP from "../app/src/lib/tallyPayroll.js";
import * as TPost from "../app/src/lib/payrollPost.js";
import { partsIn, PART_OF_RE, tpIdRe } from "../server/_shared/tpparts.js";
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
  "ESI Employee": "Duties & Taxes", "Advance Recovery": "Loans & Advances (Asset)", "Salary Payable": "Provisions", "PF Employer": "Indirect Expenses", "PF Payable": "Duties & Taxes", "Gratuity": "Indirect Expenses" };
const HEADS = { "Basic Pay": { type: "Earnings for Employees" }, "HRA": { type: "Earnings for Employees" }, "Income Tax": { type: "Deductions from Employees", stat: "Income Tax" },
  "Professional Tax": { type: "Deductions from Employees", stat: "Professional Tax" }, "PF Employee 12%": { type: "Employees' Statutory Deductions", stat: "PF Account (A/c No. 1)" },
  "ESI Employee": { type: "Employees' Statutory Deductions", stat: "Employee State Insurance" }, "Advance Recovery": { type: "Loans and Advances" }, "Salary Payable": { type: "" },
  "PF Employer": { type: "Employer's Statutory Contributions", stat: "PF Account (A/c No. 1)" }, "PF Payable": { type: "" }, "Gratuity": { type: "Gratuity" } };
const HEADROWS = Object.entries(HEADS).map(([name, h]) => ({ name, type: h.type }));
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
  const inp = nightInput(rows, b, { today: TODAY, bankRecs: [], inboxRecs: [], entryRecs: [], twob: [], gst: gstOf(rows, b, TODAY), prior: o.prior || [], draftRecs: o.draftRecs || [], jobs: {}, payHeads: o.payHeads === undefined ? HEADROWS : o.payHeads });
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
    // what the cloud keeps (a copy each time): a draft whose save never went through is not kept, as after a closed page
    Drafts: { get: (cid, id) => (drafts[id] ? JSON.parse(JSON.stringify(drafts[id])) : null), load: async () => Object.values(drafts).map((d) => JSON.parse(JSON.stringify(d))), save: async (cid, d, what) => { if (o.closeAt && o.closeAt(d)) throw new Error("the page was closed");
      drafts[d.id] = JSON.parse(JSON.stringify(d)); log.push("save " + d.id + " " + d.state); return true; } },
  };
  const answer = o.answer || ((v) => ({ id: v.id, ok: true, created: 1, vchId: String(100 + posts.length), word: "In Tally" }));
  const g = { tallyVia: () => "bridge", Bridge: { st: { version: "2.5.18" }, post: async (pl) => { posts.push(pl); log.push("post " + pl.vouchers[0].id); return { ok: true, results: [answer(pl.vouchers[0], posts.length)] }; } },
    TCloud: { on: () => true, has: () => false }, Cloud: { api: async (path) => (String(path).startsWith("night_findings") ? (o.findings || []) : []) } };
  const rpc = async (fn) => { log.push(fn); return { ok: true }; };
  const env = Object.assign({ g, A, rpc, co: rows.co, books: b, pay: b.payroll, bookId: "b1", jobs: {} }, o.noPrior ? {} : { prior: [] }, o.readMonth ? { readMonth: o.readMonth } : {});
  const run = async (e) => {
    Object.assign(globalThis, { S: { books: b, coId: "c1", companies: { c1: rows.co } }, CO: () => rows.co, GSTR: E.GSTR, GSTF: E.GSTF, GSTSet: E.GSTSet, Books: E.Books, ledGroupPath: E.ledGroupPath });
    try { return await TPost.approveTallyPayroll(Object.assign({ id: "n1", client_id: "c1", state: "ready" }, e), Object.assign({}, env, run.extra || {})); }
    finally { ["S", "CO", "GSTR", "GSTF", "GSTSet", "Books", "ledGroupPath"].forEach((k) => delete globalThis[k]); }
  };
  return { log, drafts, posts, env, b, run };
}
// Tally's copy as FinCom reads it for the month (readMonth): fn(cid, id) per part (the first n parts), read at readAt
const FRESH = "2099-01-01T00:00:00Z", STALE = "2000-01-01T00:00:00Z";
// (sixth review) each day asked for (the parts' voucher dates) read at readAt (tally_days.at)
const monthOf = (fn, readAt = FRESH, n = 1) => async (cid, ym, days) => { const parts = {}; for (let i = 1; i <= n; i++) { const id = "dc-tp-" + ym + "-c1-" + i, t = await fn(cid, id); if (t && (t.found || t.deleted)) parts[id] = t; } return { dayAt: Object.fromEntries((days || []).map((d) => [d, readAt])), parts }; };
const notIn = monthOf(async () => ({ found: false }));
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
  ok(!r.ok && w.posts.map((p) => p.vouchers[0].id).join() === "dc-tp-202610-c1-1,dc-tp-202610-c1-2" && w.log.includes("entry_release"), "the real second check passes; part 1 posted, part 2 refused, released");
  const i1 = w.log.indexOf("post dc-tp-202610-c1-1"), i2 = w.log.indexOf("post dc-tp-202610-c1-2"), saves = w.log.filter((l) => /^save/.test(l));
  ok(w.log.slice(0, i1).filter((l) => /^save/.test(l)).join() === "save dc-tp-202610-c1-1 posting,save dc-tp-202610-c1-2 waiting" && w.log.slice(i1, i2).filter((l) => /^save/.test(l)).join() === "save dc-tp-202610-c1-1 posted,save dc-tp-202610-c1-2 waiting,save dc-tp-202610-c1-2 posting"
    && saves[saves.length - 1] === "save dc-tp-202610-c1-2 failed",
    "third review: part 2 saved waiting before part 1 is sent; part 1's answer saved straight after it, then part 2 waiting again: " + saves.join(" > "));
  ok(draftState({ vid: "dc-tp-202610-c1-2", dedupe: "payroll:202610", state: "waiting", results: w.drafts["dc-tp-202610-c1-2"].results }, {}, Date.now()) === "failed", "  so the cloud's settle (the latest draft) sends the entry back to ready, never to approved");
  // the books synced: part 1 is in Tally (FinCom's id in its narration, its allocations in Tally's payroll read)
  const p1 = TPost.prepare({ co: rows.co, ym: YM, rows: sheet, pay: w.b.payroll, ledgers: rows.ledgers.map((l) => l.name), books: w.b }).vouchers[0], x = inTally(p1, "tp1");
  const synced = rowsOf({ sheet, vouchers: [x.voucher] });
  const t2 = night(synced, { draftRecs: asRecs(w.drafts) });
  ok(t2.entry && t2.entry.ready && JSON.stringify(t2.entry.voucher) === JSON.stringify(t.entry.voucher), "tonight with part 1 in the books: the very same entry (its own part is not salary booked by hand)");
  const w2 = world(synced, { sheet, drafts: w.drafts, allocs: x.allocs, pv: x.pv });
  first = false;
  w2.env.g.Bridge.post = w.env.g.Bridge.post; w2.posts.push = (...a) => w.posts.push(...a);
  r = await w2.run(t.entry);
  ok(r.ok && w.posts.length === 3 && w.posts[2].vouchers[0].id === "dc-tp-202610-c1-2" && /Part 1 of 2: Tally created 1/.test(r.words) && /Part 2 of 2: Tally created 1/.test(r.words), "Approve again with part 1 in the books: the second check passes, only part 2 is sent");
  const t3 = night(synced, { draftRecs: asRecs(w2.drafts) });
  ok(!t3.entry && !t3.finding, "both parts posted: the month is done (nothing prepared again)");
  // B2: the sheet sorted another way moves nobody between parts
  const rev = TPost.prepare({ co: rows.co, ym: YM, rows: sheet.slice().reverse(), pay: w.b.payroll, ledgers: rows.ledgers.map((l) => l.name), books: w.b });
  const fwd = TPost.prepare({ co: rows.co, ym: YM, rows: sheet, pay: w.b.payroll, ledgers: rows.ledgers.map((l) => l.name), books: w.b });
  ok(rev.vouchers.map(TP.payrollVoucherXml).join("") === fwd.vouchers.map(TP.payrollVoucherXml).join(""), "B2: the sheet re-sorted: the same parts, byte for byte (Tally's employee order)");
  // a part in Tally that is not the part built now (an employee moved between parts): refused, nothing sent
  const odd = JSON.parse(JSON.stringify(w.drafts)); odd["dc-tp-202610-c1-1"].vouchers[0].xml = odd["dc-tp-202610-c1-1"].sent.xml = odd["dc-tp-202610-c1-1"].sent.xml.replace("Made Up Person 000", "Made Up Person 149");
  delete odd["dc-tp-202610-c1-2"];
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
  // (third, fifth reviews) the posting computer's record ("already sent") and "already in Tally" count only when FinCom's
  // record of the earlier send is this very XML
  const v6 = TPost.prepare({ co: rows6.co, ym: YM, rows: SHEET, pay: payOf(SHEET), ledgers: rows6.ledgers.map((l) => l.name), books: {} }).vouchers[0], x6 = TP.payrollVoucherXml(v6);
  const lost = (xml) => ({ "dc-tp-202610-c1-1": { id: "dc-tp-202610-c1-1", dedupe: "payroll:202610", kind: "tallyPayroll", part: 1, parts: 1, state: "posting", sent: { xml, at: "2026-11-22T10:00:00Z" }, results: { "dc-tp-202610-c1-1": { ok: false, state: "sent" } }, vouchers: [{ xml }] } });
  // (eighth review) the bridge's "already sent" with its job: on its way (its job kept), not failed, not released
  ok(TPost.resultOf({ id: "dc-tp-202610-c1-1", ok: false, alreadySent: true, sentJob: "job-77", message: "Already sent from this computer (job job-77): not sent again" }, {}, { tallyIdOf: () => "" }, (m) => m).onWay === true, "6: alreadySent with its job: on its way, not failed");
  // (eighth review) an unanswered send, its day read from Tally since and its id not there: retired, never sent under
  // that id again; its people posted as the month's next free id
  let w6 = world(rows6, { drafts: lost(x6), readMonth: notIn, answer: (v) => (v.id === "dc-tp-202610-c1-1" ? { id: v.id, ok: false, alreadySent: true, message: "Already sent from this computer: not sent again" } : { id: v.id, ok: true, created: 1, vchId: "51" }) });
  let r6 = await w6.run(e6);
  const o6 = w6.drafts["dc-tp-202610-c1-1"];
  ok(r6.ok && w6.posts.length === 1 && w6.posts[0].vouchers[0].id === "dc-tp-202610-c1-2" && o6.retiredBy && JSON.stringify(o6.replacedBy) === '["dc-tp-202610-c1-2"]' && w6.drafts["dc-tp-202610-c1-2"].results["dc-tp-202610-c1-2"].ok,
    "  eighth review: an unanswered send proven not in Tally: retired (replaced by dc-tp-202610-c1-2), posted under the fresh id, in Tally");
  w6 = world(rows6, { answer: (v) => ({ id: v.id, ok: false, alreadySent: true, sentJob: "job-77", message: "Already sent from this computer (job job-77): not sent again" }) });
  r6 = await w6.run(e6);
  ok(!r6.ok && /sent part 1 before with other contents/.test(r6.why) && w6.log.includes("entry_release"), "  fifth review: alreadySent with no record of that XML: refused, released (never taken as on its way)");
  const has41 = async () => ({ found: true, no: "41", employees: TPost.readVoucherXml(x6).employees });
  w6 = world(rows6, { drafts: lost(x6), readMonth: monthOf(async () => ({ found: false }), STALE) });
  r6 = await w6.run(e6);
  ok(!r6.ok && !w6.posts.length && /older than this send/.test(r6.why), "  an unanswered send, its day not read since: waits, nothing sent");
  w6 = world(rows6, { drafts: lost(x6), readMonth: monthOf(has41) });
  r6 = await w6.run(e6);
  ok(r6.ok && !w6.posts.length && /already in Tally/.test(r6.words) && w6.drafts["dc-tp-202610-c1-1"].results["dc-tp-202610-c1-1"].tallyId === "41", "  fourth review: an unanswered send found in Tally's copy with the same figures: in Tally, not sent again");
  w6 = world(rows6, { answer: (v) => ({ id: v.id, ok: true, existed: true, vchId: "42" }) });
  r6 = await w6.run(e6);
  ok(!r6.ok && /from an earlier send FinCom has no record of/.test(r6.why) && w6.log.includes("entry_release"), "  already in Tally with no record of sending it: refused, released (what is in Tally can't be vouched for)");
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

console.log("re-review 1: the employer's contributions are not salary booked");
{
  ok(earningHead("Basic Pay", "Earnings for Employees") && earningHead("Bonus", "Bonus") && !earningHead("PF Employer", "Employer's Statutory Contributions") && !earningHead("Gratuity", "Gratuity")
    && !earningHead("Conveyance", "Reimbursements to Employees") && !earningHead("PF Employer", "") && !earningHead("EDLI Admin Charges", "") && earningHead("HRA", ""), "a pay head is salary only when it is an earning (by Tally's type; with none, by its name)");
  const er = (guid, day, amt, led = "PF Employer") => ({ guid, day, type: "Payroll", narr: "PF employer's share", lines: [[led, -amt], ["PF Payable", amt]] });
  let t = night(rowsOf({ vouchers: [er("er1", "2026-10-31", 3600)] }));
  ok(t.entry && t.entry.ready, "the employer's PF (₹3,600, a Payroll voucher) entered before the salary: the month is still prepared");
  t = night(rowsOf({ vouchers: [er("er1", "2026-10-31", 3600), er("gr1", "2026-10-31", 1500, "Gratuity")] }), { payHeads: Object.keys(PAYHEADS) });
  ok(t.entry && t.entry.ready, "  and with the pay heads' types unknown (an older bridge): by name, still prepared (gratuity too)");
  const rows = rowsOf({ vouchers: [er("er1", "2026-10-31", 3600)] }), e = night(rows).entry;
  const w = world(rows, { allocs: [{ guid: "er1", day: "20261031", head: "PF Employer", employee: "Ravi Kumar", amt: 3600 }], pv: { er1: { day: "20261031", type: "Payroll", no: "5", narr: "PF employer's share" } } });
  const r = await w.run(e);
  ok(r.ok && w.posts.length === 1, "  Approve: the employer's PF entry in Tally's payroll read is not a payroll entry FinCom did not post: posted");
  // a split month: part 1 in, then the employer's contributions booked, then part 2
  const sheet = many(150), r0 = rowsOf({ sheet }), t0 = night(r0);
  let first = true;
  const w0 = world(r0, { sheet, answer: (v, k) => (v.id.endsWith("-2") && first ? { id: v.id, ok: false, message: "Voucher type 'Payroll' does not exist" } : { id: v.id, ok: true, created: 1, vchId: "3" + k }) });
  await w0.run(t0.entry);
  const p1 = TPost.prepare({ co: r0.co, ym: YM, rows: sheet, pay: w0.b.payroll, ledgers: r0.ledgers.map((l) => l.name), books: w0.b }).vouchers[0], x = inTally(p1, "tp1");
  const synced = rowsOf({ sheet, vouchers: [x.voucher, er("er2", "2026-10-31", 21600)] });
  ok(JSON.stringify((night(synced, { draftRecs: asRecs(w0.drafts) }).entry || {}).voucher) === JSON.stringify(t0.entry.voucher), "  a split month: part 1 in, then the employer's PF booked: the same night entry");
  first = false;
  const w1 = world(synced, { sheet, drafts: w0.drafts, allocs: x.allocs.concat([{ guid: "er2", day: "20261031", head: "PF Employer", employee: "Made Up Person 000", amt: 21600 }]), pv: Object.assign({}, x.pv, { er2: { day: "20261031", type: "Payroll", no: "9", narr: "PF employer" } }) });
  const r1 = await w1.run(t0.entry);
  ok(r1.ok && w1.posts.length === 1 && w1.posts[0].vouchers[0].id === "dc-tp-202610-c1-2", "  and Approve posts part 2");
}

console.log("re-review 2: the resend guard's answer with no job");
{
  // (fifth review) the very XML sent before from that computer (its send unanswered, not in a copy read after it)
  const rows = rowsOf(), e = night(rows).entry;
  const xs = TP.payrollVoucherXml(TPost.prepare({ co: rows.co, ym: YM, rows: SHEET, pay: payOf(SHEET), ledgers: rows.ledgers.map((l) => l.name), books: {} }).vouchers[0]);
  // (eighth review) as postOne saves it: the very XML on record, the computer's "already sent" with no job
  const res = Object.assign(TPost.resultOf({ id: "dc-tp-202610-c1-1", ok: false, alreadySent: true, message: "Already sent from this computer: not sent again" }, {}, { tallyIdOf: () => "" }, (m) => m), { at: new Date().toISOString() });
  const d = { id: "dc-tp-202610-c1-1", dedupe: "payroll:202610", part: 1, parts: 1, state: "posted", sent: { xml: xs, at: res.at, answered: "ok" }, results: { "dc-tp-202610-c1-1": res }, vouchers: [{ xml: xs, date: "2026-10-31" }] };
  ok(res.ok && res.unconfirmed && !res.tallyId && /Tally has not confirmed it yet/.test(TPost.partWords(Object.assign({ part: 1, parts: 1 }, res))), "saved as posted without Tally's voucher id (not failed, not on its way to a job that is not there)");
  ok(draftState({ vid: d.id, dedupe: d.dedupe, state: d.state, results: d.results, at: res.at }, {}, Date.now()) === "pending", "  the 24-hour rule: pending now");
  const old = JSON.parse(JSON.stringify(d)); old.results[d.id].at = new Date(Date.now() - 26 * 3600e3).toISOString();
  let t = night(rows, { draftRecs: asRecs({ [d.id]: old }) });
  ok(!t.entry && !journals(t.inp).findings.some((f) => f.kind === "sent_check"), "  sixth review: 26 hours on, its day not read from Tally since: waits (no 24-hour rule)");
  t = night(Object.assign({}, rows, { days: [{ day: "2026-10-31", at: FRESH }] }), { draftRecs: asRecs({ [d.id]: JSON.parse(JSON.stringify(d)) }) });
  ok(!t.entry && t.inp && journals(t.inp).findings.some((f) => f.kind === "sent_check" && /not in Tally’s copy of its day read since/.test(f.facts.title)), "  its day read after the send, the id not there: “Not confirmed in Tally” (Needs you) at once");
}

console.log("re-review 3: Approve reads last night's findings (the owner's ledger pick)");
{
  const pick = [{ kind: "ledger_pick", key: "led:salaryPayable", state: "resolved", evidence: [{ t: "ledger", ledger: "Staff Dues" }], undone: false }];
  const rows = rowsOf({ co: { payrollPayable: "" }, drop: ["Salary Payable"], ledgers: { "Staff Dues": "Provisions" } }), t = night(rows, { prior: pick });
  ok(t.entry && t.entry.voucher.party === "Staff Dues", "the night: the payable as the owner picked it in Daily Check");
  let w = world(rows, { noPrior: true, findings: pick.map((p) => ({ client_id: "c1", kind: p.kind, key: p.key, state: p.state, evidence: p.evidence, undone_at: null })) });
  let r = await w.run(t.entry);
  ok(r.ok && w.posts.length === 1 && /<LEDGERNAME>Staff Dues<\/LEDGERNAME>/.test(w.posts[0].vouchers[0].xml), "Approve from the Payroll page (no findings handed in): reads them itself, posts to Staff Dues");
  w = world(rows, { noPrior: true, findings: [] });
  r = await w.run(t.entry);
  ok(!r.ok && r.why === TPost.CHANGED, "  (without them the second check would refuse: what it did before)");
}

console.log("re-review 4: a part in Tally that differs: what changed, and accept it as it is");
{
  const sheet = many(150), rows = rowsOf({ sheet }), t = night(rows);
  let first = true;
  const w = world(rows, { sheet, answer: (v, k) => (v.id.endsWith("-2") && first ? { id: v.id, ok: false, message: "Voucher type 'Payroll' does not exist" } : { id: v.id, ok: true, created: 1, vchId: "4" + k }) });
  await w.run(t.entry); first = false;
  const p1 = TPost.prepare({ co: rows.co, ym: YM, rows: sheet, pay: w.b.payroll, ledgers: rows.ledgers.map((l) => l.name), books: w.b }).vouchers[0], x = inTally(p1, "tp1");
  const synced = rowsOf({ sheet, vouchers: [x.voucher] });
  const emps = sheet.map((r, i) => ({ name: r.name, category: i === 0 ? "Head Office" : "" }));
  const w2 = world(synced, { sheet, emps, drafts: JSON.parse(JSON.stringify(w.drafts)), allocs: x.allocs, pv: x.pv });
  w2.env.g.Bridge.post = async (pl) => { w2.posts.push(pl); return { ok: true, results: [{ id: pl.vouchers[0].id, ok: true, created: 1, vchId: "77" }] }; };
  let r = await w2.run(t.entry);
  ok(!r.ok && r.stuck && r.canAccept && /Made Up Person 000’s cost category \(Primary Cost Category in Tally, Head Office now\)/.test(r.why) && /accept part 1 as it is in Tally and post the rest/.test(r.why) && !w2.posts.length,
    "an employee's category changed since part 1: said exactly, accepting offered, nothing sent: " + r.why.slice(0, 160));
  w2.run.extra = { accept: true };
  r = await w2.run(t.entry);
  const xs = w2.posts.map((pl) => pl.vouchers[0].xml).join("");
  ok(r.ok && w2.posts.length === 1 && w2.posts[0].vouchers[0].id === "dc-tp-202610-c1-2" && (xs.match(/<EMPLOYEEENTRIES\.LIST>/g) || []).length === 50 && !/Made Up Person 0\d\d</.test(xs) && /part 2 of 2/.test(xs),
    "accepted: part 1 kept as it is in Tally; only the 50 employees not in it posted (part 2 of 2), nobody sent twice");
  ok(w2.drafts["dc-tp-202610-c1-1"].accepted && w2.drafts["dc-tp-202610-c1-1"].accepted.by === "Made-up Person", "  the acceptance kept on part 1's draft (who)");
  // amounts changed for someone in part 1: no accepting (the parts would not add up)
  const sheet2 = sheet.map((r, i) => (i === 0 ? emp(r.name, 10500, 2000, { pt: 200 }) : r)), rows2 = rowsOf({ sheet: sheet2, vouchers: [x.voucher] }), t2 = night(rows2, { draftRecs: asRecs(w.drafts) });
  const w3 = world(rows2, { sheet: sheet2, drafts: JSON.parse(JSON.stringify(w.drafts)), allocs: x.allocs, pv: x.pv });
  r = await w3.run(t2.entry);
  ok(t2.entry && !r.ok && r.stuck && !r.canAccept && /Made Up Person 000’s net \(₹11,800 in Tally, ₹12,300 now\)/.test(r.why) && /other amounts than the sheet/.test(r.why) && !w3.posts.length, "an amount changed in part 1: said, no accepting, nothing sent");
}

console.log("re-review 6: a part of FinCom's own not yet in the books here");
{
  const rows = rowsOf(), b = booksOf(rows), alloc = [{ guid: "ours", day: "20261031", head: "Basic Pay", employee: "Ravi Kumar", amt: -25000 }];
  let p = TPost.prepare({ co: rows.co, ym: YM, rows: SHEET, pay: payOf(SHEET, { allocs: alloc, pv: { ours: { day: "20261031", type: "Payroll", no: "3", narr: "Salary | TDSDesk:dc-tp-202610-c1-1" } } }), ledgers: rows.ledgers.map((l) => l.name), books: b });
  ok(!p.problems.length && p.vouchers.length === 1, "Tally's payroll read has its narration (FinCom's id): FinCom's own, not refused");
  p = TPost.prepare({ co: rows.co, ym: YM, rows: SHEET, pay: payOf(SHEET, { allocs: alloc, pv: { ours: { day: "20261031", type: "Payroll", no: "3" } } }), ledgers: rows.ledgers.map((l) => l.name), books: b });
  ok(!p.vouchers.length && /does not have the payroll entry of Oct 2026 Tally has \(Payroll no\. 3 31-10-2026\) yet\. Read the books again/.test(p.problems[0]), "  with no narration either way: unknown, read the books again (never “not posted by FinCom”)");
}

console.log("re-review 8 and 9: dates masked by column; carrying over by code, PAN, then name");
{
  const sm = PS.samples(["Name", "DOB", "Joining", "Pay Month", "Basic"], [["Ravi", "01-01-1990", new Date(2015, 3, 1), new Date(2026, 9, 1), "25000"], ["Asha", new Date(1991, 0, 1), "01/04/2016", "Oct-2026", "9000"]]);
  ok(/^DATE_\d$/.test(sm.rows[0][1]) && /^DATE_\d$/.test(sm.rows[1][1]) && /^DATE_\d$/.test(sm.rows[0][2]) && /^DATE_\d$/.test(sm.rows[1][2]), "a date of birth or joining on the 1st (01-01-1990, a date cell): masked in full");
  ok(sm.rows[0][3] === "2026-10" && sm.rows[1][3] === "Oct-2026", "  the pay month column: the month kept");
  const odd = PS.samples(["Name", "Remarks"], [["Ravi", "Oct-2026"]]);
  ok(/^DATE_\d$/.test(odd.rows[0][1]), "  a month outside the pay month column: masked");
  let S2 = null; try { S2 = await import("../server/assistant/sheetmap.ts"); } catch (e) { /* no TypeScript here */ }
  if (S2) ok(S2.payrollMask("Ravi Kumar") === "TEXT" && S2.payrollMask("01-01-1990") === "DATE" && S2.payrollMask("Oct-2026") === "Oct-2026" && S2.payrollMask("TEXT_2") === "TEXT_2", "  the server masks a name in a cell itself");
  const old = [Object.assign({}, SHEET[0], { code: "E1", pan: "ABCDE1234F", taxable: 300000, regime: "old" }), Object.assign({}, SHEET[1], { code: "E2", exempt: 5000 }), Object.assign({}, SHEET[2], { code: "E3", name: "Sunil Mehta (left)", pan: "", chapter6: 1000 })];
  const fresh = [Object.assign({}, SHEET[0], { code: "EMP-001", pan: "ABCDE1234F" }), Object.assign({}, SHEET[1], { code: "EMP-002" }), Object.assign({}, SHEET[2], { code: "EMP-003" })];
  const m = PS.mergeSalary(old, fresh), w = PS.replacing(old, fresh);
  ok(m[0].taxable === 300000 && m[0].regime === "old" && m[1].exempt === 5000 && !m[2].chapter6, "codes changed: carried over by PAN (Ravi), then by name (Asha); Mehta (another name, no PAN) not");
  ok(w.carried.join() === "Ravi Kumar,Asha Verma" && w.missed.join() === "Sunil Mehta (left)", "  the warning's figures: 2 carried over, the one not carried named");
}

console.log("re-review 7: Tally's payroll read leaves out merged and deleted ledgers, as the night does");
{
  const src = (await import("node:fs")).readFileSync(new URL("../src/js/73-payroll.js", import.meta.url), "utf8");
  ok(/tally_ledgers\?select=name,pay_type,pay_stat_type,it_component,for_payroll&for_payroll=eq\.true&merged_into=is\.null&deleted_at=is\.null"/.test(src), "Payroll.into: the pay heads with merged_into and deleted_at null");
  ok(/tally_vouchers\?select=guid,alter_id,day,vtype,vno,narration,/.test(src) && /narr: String\(v\.narration \|\| ""\)/.test(src), "  and each payroll entry's narration kept (re-review 6)");
}

console.log("third review: the page closed between parts, and the sheet changed before the retry");
{
  // a made-up Tally that keeps each voucher by FinCom's id: a second send of an id is "Already in Tally"
  const tallyOf = () => { const T = new Map(); return { T, read: async (cid, id) => (T.has(id) ? { found: true, no: String(Array.from(T.keys()).indexOf(id) + 1), employees: TPost.readVoucherXml(T.get(id)).employees } : { found: false, deleted: false }), answer: (v) => { if (T.has(v.id)) return { id: v.id, ok: false, message: "Already in Tally (voucher no. " + (Array.from(T.keys()).indexOf(v.id) + 1) + ")" }; T.set(v.id, v.xml); return { id: v.id, ok: true, created: 1, vchId: String(500 + T.size) }; } }; };
  const paid = (T) => Array.from(T.values()).flatMap((x) => TPost.readVoucherXml(x).employees.map((e) => e.name));
  const sheet = many(150), rows = rowsOf({ sheet }), t = night(rows);
  // the late joiner comes first in Tally's employee list (by name), so part 1 built now is not part 1 as sent
  const late = emp("Aaa Late Joiner", 9000, 1000, { pt: 200 }), sheet2 = [late].concat(sheet);
  for (const [lostAnswer, words] of [[false, "after part 1's answer was saved"], [true, "before part 1's answer was saved"]]) {
    const ty = tallyOf();
    const w = world(rows, { sheet, answer: (v) => ty.answer({ id: v.id, xml: w.posts[w.posts.length - 1].vouchers[0].xml }),
      closeAt: (d) => (lostAnswer ? d.id === "dc-tp-202610-c1-1" && d.state === "posted" : d.id === "dc-tp-202610-c1-2" && d.state === "posting") });
    let closed = false; try { await w.run(t.entry); } catch (x) { closed = /closed/.test(String(x && x.message)); }
    ok(closed && ty.T.size === 1, "the page closed " + words + ": part 1 in Tally, part 2 never sent");
    const p1 = TPost.readVoucherXml(ty.T.get("dc-tp-202610-c1-1"));
    const x = inTally({ id: "dc-tp-202610-c1-1", narration: (ty.T.get("dc-tp-202610-c1-1").match(/<NARRATION>([^<|]*)/) || [])[1].trim(), payable: "Salary Payable", net: p1.net, employees: p1.employees.map((e) => ({ name: e.name, heads: e.heads })) }, "tp1");
    const rows2 = rowsOf({ sheet: sheet2, vouchers: [x.voucher] }), t2 = night(rows2, { draftRecs: asRecs(w.drafts) });
    const w2 = world(rows2, { sheet: sheet2, drafts: JSON.parse(JSON.stringify(w.drafts)), allocs: x.allocs, pv: x.pv, readMonth: monthOf(ty.read, FRESH, 3), answer: (v) => ty.answer({ id: v.id, xml: w2.posts[w2.posts.length - 1].vouchers[0].xml }) });
    const r = await w2.run(t2.entry);
    ok(t2.entry && !r.ok && r.stuck && ty.T.size === 1 && !w2.posts.length, "  the retry with a late joiner: refused, nothing sent (" + String(r.why || "it was posted").slice(0, 120) + "…)");
    ok(r.canAccept && /joined this part now: Aaa Late Joiner/.test(String(r.why)) && /in another part now: Made Up Person 099 \(now part 2\)/.test(String(r.why)), "  what changed, by name: who joined part 1 and who is in another part now" + (lostAnswer ? " (the lost answer settled from Tally's copy first)" : ""));
    w2.run.extra = { accept: true };
    const r2 = await w2.run(t2.entry), names2 = paid(ty.T);
    ok(r2.ok && names2.length === 151 && new Set(names2).size === 151 && names2.includes("Aaa Late Joiner"), "  accepted as it is in Tally: everyone on the sheet paid exactly once (151), the late joiner too");
    const names = paid(ty.T);
    ok(new Set(names).size === names.length, "  nobody paid twice");
  }
}

console.log("third review: types first, the accepted parts counted, acceptance asked again, books before 'Not confirmed'");
{
  ok(!earningHead("Company PF Share", "") && !earningHead("Mediclaim (Company)", "") && !earningHead("Employer ESI", "") && earningHead("Arrears", "") && earningHead("Arrears", "Reimbursements to Employees")
    && !earningHead("Conveyance", "Reimbursements to Employees") && earningHead("Company Car Allowance", "Earnings for Employees") && !earningHead("Basic Pay", "Employer's Other Charges"),
    "(a) a type given: the type alone (an earning named “Company …” is salary; one typed employer's is not); no type: employer-style names are not salary; arrears always are");
  const heads = HEADROWS.concat([{ name: "Company Car Allowance", type: "Earnings for Employees" }]);
  const gross = r2(SHEET.reduce((x, r) => x + r.gross, 0));
  const car = { guid: "car1", day: "2026-10-31", type: "Payroll", narr: "Oct salary", lines: [["Company Car Allowance", -gross], ["Salary Payable", gross]] };
  const t = night(rowsOf({ vouchers: [car], ledgers: { "Company Car Allowance": "Indirect Expenses" } }), { payHeads: heads });
  ok(!t.entry && !t.finding, "  the night: a hand payroll voucher to an earning named “Company Car Allowance” (typed an earning) is salary booked");
  // (b), (c): accepting where the rest makes two parts (a second category in it): the month's count of parts on every part
  const sheet = many(150), rows = rowsOf({ sheet }), t0 = night(rows);
  let first = true;
  const w = world(rows, { sheet, answer: (v, k) => (v.id.endsWith("-2") && first ? { id: v.id, ok: false, message: "Voucher type 'Payroll' does not exist" } : { id: v.id, ok: true, created: 1, vchId: "6" + k }) });
  await w.run(t0.entry); first = false;
  const p1 = TPost.prepare({ co: rows.co, ym: YM, rows: sheet, pay: w.b.payroll, ledgers: rows.ledgers.map((l) => l.name), books: w.b }).vouchers[0], x = inTally(p1, "tp1");
  const synced = rowsOf({ sheet, vouchers: [x.voucher] });
  const emps = sheet.map((r, i) => ({ name: r.name, category: i === 0 || i === 120 ? "Head Office" : "" }));
  let refuse = true;
  const w2 = world(synced, { sheet, emps, drafts: JSON.parse(JSON.stringify(w.drafts)), allocs: x.allocs, pv: x.pv });
  w2.env.g.Bridge.post = async (pl) => { w2.posts.push(pl); return { ok: true, results: [refuse ? { id: pl.vouchers[0].id, ok: false, message: "Ledger 'Salary Payable' does not exist" } : { id: pl.vouchers[0].id, ok: true, created: 1, vchId: "8" + w2.posts.length }] }; };
  w2.run.extra = { accept: true };
  let r = await w2.run(t0.entry);
  ok(!r.ok && w2.drafts["dc-tp-202610-c1-1"].accepted && w2.drafts["dc-tp-202610-c1-1"].parts === 3, "(b) accepted, the rest in two parts: part 1's draft says the month now has 3 parts");
  refuse = false; w2.run.extra = {};
  r = await w2.run(t0.entry);
  ok(r.ok && w2.posts.slice(-2).map((pl) => pl.vouchers[0].id).join() === "dc-tp-202610-c1-2,dc-tp-202610-c1-3", "(c) the same differences as accepted: not asked again; parts 2 and 3 posted");
  const tn = night(rowsOf({ sheet, vouchers: [x.voucher] }), { draftRecs: asRecs(w2.drafts) });
  ok(!tn.entry && !tn.finding, "(b) the night counts the month done (3 parts of 3)");
  const w3 = world(synced, { sheet, emps: sheet.map((r0, i) => ({ name: r0.name, category: i === 0 || i === 120 || i === 130 ? "Head Office" : "" })), drafts: JSON.parse(JSON.stringify(w.drafts)), allocs: x.allocs, pv: x.pv });
  const d1 = w3.drafts["dc-tp-202610-c1-1"]; d1.accepted = JSON.parse(JSON.stringify(w2.drafts["dc-tp-202610-c1-1"].accepted));
  r = await w3.run(t0.entry);
  ok(!r.ok && r.stuck && r.canAccept && !w3.posts.length, "(c) something else differs since the acceptance (another category moved): asked again, nothing sent");
  // (d) a part whose draft says unconfirmed but whose FinCom id is in the books: no "Not confirmed in Tally"
  const v1 = TPost.prepare({ co: rows.co, ym: YM, rows: SHEET, pay: payOf(SHEET), ledgers: rows.ledgers.map((l) => l.name), books: {} }).vouchers[0], xi = inTally(v1, "tq1");
  const dr = { "dc-tp-202610-c1-1": { id: "dc-tp-202610-c1-1", dedupe: "payroll:202610", parts: 1, part: 1, state: "posted", results: { "dc-tp-202610-c1-1": { ok: true, at: new Date(Date.now() - 30 * 3600e3).toISOString() } } } };
  const tb = night(rowsOf({ vouchers: [xi.voucher] }), { draftRecs: asRecs(dr) }), all = journals(tb.inp).findings;
  ok(!all.some((f) => f.kind === "sent_check") && !tb.entry, "(d) its FinCom id in the books: in Tally, no “Not confirmed in Tally”, the month done");
}

console.log("fourth review (6): no type, an earning named “Company …” is salary");
ok(earningHead("Company Car Allowance", "") && earningHead("Company Lease Allowance", "") && !earningHead("Company PF Share", "") && !earningHead("Company ESI", "") && !earningHead("Co. Share of PF", ""), "“company” is employer's only with a share, PF, ESI or insurance word");

console.log("fourth review: sends never answered, settled from Tally itself");
{
  const rows = rowsOf(), e = night(rows).entry;
  const v1 = TPost.prepare({ co: rows.co, ym: YM, rows: SHEET, pay: payOf(SHEET), ledgers: rows.ledgers.map((l) => l.name), books: {} }).vouchers[0], x1 = TP.payrollVoucherXml(v1);
  const sheetB = SHEET.map((r) => (r.name === "Asha Verma" ? emp(r.name, 16000, 6000, { pt: 200, pf: 1800, esi: 188, adv: 2000 }) : r)), rowsB = rowsOf({ sheet: sheetB }), eB = night(rowsB).entry;
  const draft = (sent) => ({ "dc-tp-202610-c1-1": { id: "dc-tp-202610-c1-1", dedupe: "payroll:202610", kind: "tallyPayroll", part: 1, parts: 1, state: sent.unknown ? "failed" : "posting", sent, results: { "dc-tp-202610-c1-1": { ok: false, state: sent.unknown ? "failed" : "sent", at: "2026-11-22T10:00:00Z" } }, vouchers: [{ xml: x1, date: "2026-10-31" }] } });
  // B: part 1 really in Tally with the old figures; the sheet changed since (Asha's basic)
  let w = world(rowsB, { sheet: sheetB, drafts: draft({ xml: x1, at: "2026-11-22T10:00:00Z" }), readMonth: monthOf(async () => ({ found: true, no: "7", employees: TPost.readVoucherXml(x1).employees })) });
  let r = await w.run(eB);
  ok(!r.ok && r.stuck && !w.posts.length && w.drafts["dc-tp-202610-c1-1"].sent.answered === "ok" && /Asha Verma’s net/.test(r.why), "B: the unanswered send found in Tally (old figures): settled as in Tally, the change named, nothing sent: " + r.why.slice(0, 120));
  ok(!r.canAccept, "  (Asha's amount differs from the sheet: no accepting; correct Tally or the sheet)");
  w = world(rowsB, { sheet: sheetB, drafts: draft({ xml: x1, at: "2026-11-22T10:00:00Z" }), readMonth: monthOf(async () => ({ found: false, deleted: true })) });
  r = await w.run(eB);
  ok(r.ok && w.posts.length === 1 && /Asha Verma/.test(w.posts[0].vouchers[0].xml) && /<AMOUNT>-16000\.00<\/AMOUNT>/.test(w.posts[0].vouchers[0].xml), "B after part 1 is deleted in Tally: settled as not posted, the part built now posted");
  w = world(rowsB, { sheet: sheetB, drafts: draft({ xml: x1, at: "2026-11-22T10:00:00Z" }) });
  w.env.g.Cloud.api = async (path) => (/tally_post_jobs/.test(path) ? [{ id: "j9", status: "running" }] : []);
  w.drafts["dc-tp-202610-c1-1"].job = "j9";
  r = await w.run(eB);
  ok(!r.ok && /on its way/i.test(r.why) && !w.posts.length, "  a posting of that part still running in the queue: waited for, never settled meanwhile");
  // C: Tally had it with no record of sending (sent unknown); then the voucher deleted in Tally
  w = world(rows, { drafts: draft({ xml: null, at: "", unknown: true }), readMonth: monthOf(async () => ({ found: true, no: "8", employees: TPost.readVoucherXml(x1).employees })) });
  r = await w.run(e);
  ok(r.ok && !w.posts.length && /already in Tally/.test(r.words), "C: in Tally with no record of sending: Tally's figures are the part built now: in Tally, nothing sent");
  w = world(rows, { drafts: draft({ xml: null, at: "", unknown: true }), readMonth: monthOf(async () => ({ found: false, deleted: true })) });
  r = await w.run(e);
  ok(r.ok && w.posts.length === 1 && w.posts[0].vouchers[0].id === "dc-tp-202610-c1-2" && w.drafts["dc-tp-202610-c1-2"].results["dc-tp-202610-c1-2"].ok && w.drafts["dc-tp-202610-c1-1"].retiredBy, "C after the voucher is deleted in Tally: retired, posted again under a fresh id, in Tally");
  // post as a journal this month, after settling: the night prepares the journal, Daily Check's approve settles first
  const rowsJ = rowsOf({ co: { payrollJournal: { [YM]: { by: "x" } } }, sheet: SHEET.map((r) => Object.assign({}, r, { ded: {}, otherDed: 0, net: r2(r.gross - r.tds - r.profTax - r.pf - r.esi) })), ledgers: { "TDS on Salary 192": "Duties & Taxes", "Professional Tax Payable": "Duties & Taxes", "PF Payable": "Duties & Taxes", "ESI Payable": "Duties & Taxes" } });
  const dj = draft({ xml: x1, at: new Date(Date.now() - 2 * 3600e3).toISOString() });
  rowsJ.days = [{ day: "2026-10-31", at: new Date().toISOString() }];
  const picks = [["profTax", "Professional Tax Payable"], ["pf", "PF Payable"], ["esi", "ESI Payable"]].map(([k, l]) => ({ kind: "ledger_pick", key: "led:" + k, state: "resolved", evidence: [{ t: "ledger", ledger: l }], undone: false }));
  let tj = night(rowsJ, { draftRecs: asRecs(dj), prior: picks });
  ok(tj.entry && tj.entry.voucher.kind === "payroll", "journal this month: the night prepares the journal (the unanswered Tally Payroll part is not in a copy read after it)");
  const gj = { Cloud: { api: async () => [] }, TCloud: {} }, Aj = { Drafts: { save: async (cid, d) => { dj[d.id] = JSON.parse(JSON.stringify(d)); return true; } } };
  let st = await TPost.settleParts(rowsJ.co, tj.entry || { dedupe: "payroll:" + YM, voucher: { period: YM } }, Object.values(dj), {}, Aj, gj, { forJournal: true, readMonth: monthOf(async () => ({ found: false }), STALE) });
  ok(st.waits.length === 1 && /older than this send/.test(st.waits[0]) && dj["dc-tp-202610-c1-1"].sent.answered !== "gone", "  fifth review: approving it with Tally's copy older than the send: waits (bridge 2.5.18 does not look in Tally)");
  st = await TPost.settleParts(rowsJ.co, tj.entry || { dedupe: "payroll:" + YM, voucher: { period: YM } }, Object.values(dj), {}, Aj, gj, { forJournal: true, readMonth: monthOf(async () => ({ found: false, deleted: true })) });
  ok(!st.waits.length && dj["dc-tp-202610-c1-1"].state === "failed" && dj["dc-tp-202610-c1-1"].sent.answered === "gone", "  a copy read after the send, the part not in it: settled as not posted");
  const okd = { "dc-tp-202610-c1-1": Object.assign({}, dj["dc-tp-202610-c1-1"], { state: "posted", sent: { xml: x1, answered: "ok" }, results: { "dc-tp-202610-c1-1": { ok: true, state: "posted", tallyId: "7", at: new Date(Date.now() - 3 * 3600e3).toISOString() } } }) };
  rowsJ.days = [{ day: "2026-10-31", at: new Date(Date.now() - 30 * 3600e3).toISOString() }, { day: "2026-11-20", at: new Date().toISOString() }];
  tj = night(rowsJ, { draftRecs: asRecs(okd), prior: picks });
  ok(!tj.entry, "  fifth review: a part posted in Tally, Tally's copy older than it: no journal (however long ago)");
  rowsJ.days = [{ day: "2026-10-31", at: new Date().toISOString() }];
  tj = night(rowsJ, { draftRecs: asRecs(okd), prior: picks });
  ok(tj.entry && tj.entry.ready, "  a copy read after it, its FinCom id not in the books (deleted in Tally): the journal is prepared");
  st = await TPost.settleParts(rowsJ.co, tj.entry || { dedupe: "payroll:" + YM, voucher: { period: YM } }, Object.values(okd), {}, { Drafts: { save: async (cid, d) => { okd[d.id] = JSON.parse(JSON.stringify(d)); return true; } } }, gj, { forJournal: true, readMonth: monthOf(async () => ({ found: false, deleted: true })) });
  ok(okd["dc-tp-202610-c1-1"].state === "failed", "  and Daily Check's Approve settles that part as not in Tally before the journal goes");
  st = await TPost.settleParts(rowsJ.co, { dedupe: "payroll:" + YM, voucher: { period: YM } }, [], {}, { Drafts: { save: async () => true } }, gj, { forJournal: true, readMonth: monthOf(async () => ({ found: true, no: "12", employees: TPost.readVoucherXml(x1).employees })) });
  ok(st.waits.length === 1 && /is in Tally \(voucher no\. 12\)/.test(st.waits[0]), "  fifth review: no drafts at all, part 1's FinCom id in Tally's copy: the journal is held back");
}

console.log("fifth review: a bridge as 2.5.18 is (its own record of what it sent, no look in Tally), a copy behind Tally");
{
  // bridge 2.5.18: each posting computer keeps the ids it sent (alreadySent); nothing looks in Tally, so Tally can hold the
  // same id twice. Tally's copy in FinCom's cloud is read in only when synced
  const fake = () => {
    // copy.dayAt: when each day was read from Tally (tally_days.at); sync() reads the month-end again, other() some other day
    const f = { tally: [], rec: { X: new Map(), Y: new Map() }, via: "X", copy: { dayAt: {}, snap: new Map() } };
    // released (bridge-go releaseFor): an owner's release lets a recorded id go once per release; f.lose: the posting
    // computer records the send but Tally never gets it
    f.honoured = new Set(); f.lose = false;
    f.post = (v, rel) => { const r = f.rec[f.via], x = [].concat(rel || []).find((y) => y && y.id === v.id && y.at && !f.honoured.has(y.at + "|" + y.id));
      if (r.has(v.id) && !x) return { id: v.id, ok: false, alreadySent: true, message: "Already sent from this computer: not sent again" };
      if (x) f.honoured.add(x.at + "|" + x.id);
      r.set(v.id, v.xml); if (f.lose) return { id: v.id, ok: false, message: "Tally did not answer" }; f.tally.push({ id: v.id, xml: v.xml }); return { id: v.id, ok: true, created: 1, vchId: String(f.tally.length) }; };
    f.sync = () => { f.tally.forEach((t) => f.copy.snap.set(t.id, t.xml)); f.copy.dayAt["2026-10-31"] = FRESH; };
    f.other = () => { f.copy.dayAt["2026-11-20"] = FRESH; };
    // readAt: tally_books.days_at, which moves with any day read (what fifth-review code trusted)
    f.readMonth = async (cid, ym, days) => ({ readAt: Object.values(f.copy.dayAt).sort().pop() || STALE, dayAt: Object.fromEntries((days || []).filter((d) => f.copy.dayAt[d]).map((d) => [d, f.copy.dayAt[d]])), parts: Object.fromEntries(Array.from(f.copy.snap).map(([id, xml]) => [id, { found: true, no: "1", narr: (xml.match(/<NARRATION>([^<]*)/) || [])[1], employees: TPost.readVoucherXml(xml).employees }])) });
    f.paid = () => f.tally.flatMap((t) => TPost.readVoucherXml(t.xml).employees.map((e) => e.name));
    f.books = (sheet) => rowsOf({ sheet, vouchers: Array.from(f.copy.snap).map(([id, xml], i) => { const rv = TPost.readVoucherXml(xml); return inTally({ id, narration: (xml.match(/<NARRATION>([^<|]*)/) || [])[1].trim(), payable: rv.payable, net: rv.net, employees: rv.employees }, "g" + i).voucher; }) });
    f.allocs = () => Array.from(f.copy.snap).flatMap(([id, xml], i) => { const rv = TPost.readVoucherXml(xml); return inTally({ id, narration: "x", payable: rv.payable, net: rv.net, employees: rv.employees }, "g" + i).allocs; });
    f.pv = () => Object.fromEntries(Array.from(f.copy.snap).map(([id], i) => ["g" + i, { day: "20261031", type: "Payroll", no: String(i + 1) }]));
    return f;
  };
  const wire = (w, f) => { w.env.g.TCloud = { on: () => true, has: () => true, book: () => ({ book: "b1" }), postThrough: () => ({ version: "2.5.18", computer: "PC-" + f.via, id: f.via }) };
    w.env.g.Bridge.post = async (pl) => { w.posts.push(pl); return { ok: true, results: [f.post(pl.vouchers[0], pl.released)] }; }; w.env.readMonth = f.readMonth; return w; };
  const sheet = many(150), rows = rowsOf({ sheet }), t = night(rows);
  const once = (f, n) => { const p = f.paid(); return p.length === n && new Set(p).size === n; };
  // L: part 1 reaches Tally through X, the page closes before its answer is saved; an employee's category moves; the copy
  // has not caught up
  {
    const f = fake();
    const w = wire(world(rows, { sheet, closeAt: (d) => d.id === "dc-tp-202610-c1-1" && d.state === "posted" }), f);
    try { await w.run(t.entry); } catch (x) { /* the page closed */ }
    const emps = sheet.map((r, i) => ({ name: r.name, category: i === 0 ? "Head Office" : "" }));
    const w2 = wire(world(rows, { sheet, emps, drafts: JSON.parse(JSON.stringify(w.drafts)) }), f);
    let r = await w2.run(t.entry);
    ok(!r.ok && /is older than this send/.test(r.why) && f.tally.length === 1, "L: the copy older than part 1's send: waits, nothing sent (2.5.18 would answer alreadySent and Tally would get parts 2 and 3 with someone twice)");
    f.sync();
    const rowsS = f.books(sheet), tS = night(rowsS, { draftRecs: asRecs(w2.drafts) });
    const w3 = wire(world(rowsS, { sheet, emps, drafts: JSON.parse(JSON.stringify(w2.drafts)), allocs: f.allocs(), pv: f.pv() }), f);
    r = await w3.run(tS.entry);
    ok(!r.ok && r.stuck && r.canAccept && f.tally.length === 1, "  the copy read in: part 1 found as sent; the category move named, accepting offered");
    w3.run.extra = { accept: true };
    r = await w3.run(tS.entry);
    ok(r.ok && once(f, 150), "  accepted: everyone paid exactly once (150)");
  }
  // L2: the same sheet, but the queue now hands the posting to computer Y (no record of part 1 there)
  {
    const f = fake();
    const w = wire(world(rows, { sheet, closeAt: (d) => d.id === "dc-tp-202610-c1-1" && d.state === "posted" }), f);
    try { await w.run(t.entry); } catch (x) { /* the page closed */ }
    f.via = "Y";
    const w2 = wire(world(rows, { sheet, drafts: JSON.parse(JSON.stringify(w.drafts)) }), f);
    let r = await w2.run(t.entry);
    ok(!r.ok && f.tally.length === 1 && !f.rec.Y.size, "L2: the same XML, the queue now on computer Y, the copy behind: nothing sent through Y (100 would be paid twice)");
    f.sync();
    const rowsS = f.books(sheet), tS = night(rowsS, { draftRecs: asRecs(w2.drafts) });
    const w3 = wire(world(rowsS, { sheet, drafts: JSON.parse(JSON.stringify(w2.drafts)), allocs: f.allocs(), pv: f.pv() }), f);
    r = await w3.run(tS.entry);
    ok(r.ok && once(f, 150) && f.tally.length === 2, "  the copy read in: part 1 is in Tally; only part 2 posted; everyone paid once");
  }
  // L3: part 1 settled earlier as not in Tally (a copy read after it), then the sheet changed; computer X still has part
  // 1's id on its record and answers alreadySent for the other XML: refused, nothing more sent
  {
    const f = fake();
    const v1 = TPost.prepare({ co: rows.co, ym: YM, rows: sheet, pay: payOf(sheet), ledgers: rows.ledgers.map((l) => l.name), books: {} }).vouchers[0], xa = TP.payrollVoucherXml(v1);
    f.rec.X.set("dc-tp-202610-c1-1", xa); f.copy.dayAt["2026-10-31"] = FRESH;
    const gone = { "dc-tp-202610-c1-1": { id: "dc-tp-202610-c1-1", dedupe: "payroll:202610", part: 1, parts: 2, state: "failed", sent: { xml: xa, at: "2026-11-22T10:00:00Z", via: "bridge:X", answered: "gone" }, results: { "dc-tp-202610-c1-1": { ok: false, state: "failed", said: "not in Tally" } }, vouchers: [{ xml: xa }] } };
    const emps = sheet.map((r, i) => ({ name: r.name, category: i === 0 ? "Head Office" : "" }));
    const w = wire(world(rows, { sheet, emps, drafts: gone }), f);
    const r = await w.run(t.entry);
    ok(!r.ok && /sent part 1 before with other contents/.test(r.why) && f.tally.length === 0 && w.posts.length === 1 && w.log.includes("entry_release"), "L3: alreadySent for other contents than the record: refused, released, parts 2 and 3 never sent");
  }
  // drafts lost: part 1 in Tally (the copy read in), no draft at all: counted from its FinCom id; only part 2 posted
  {
    const f = fake();
    const w = wire(world(rows, { sheet, closeAt: (d) => d.id === "dc-tp-202610-c1-2" && d.state === "posting" }), f);
    try { await w.run(t.entry); } catch (x) { /* the page closed */ }
    f.sync();
    const rowsS = f.books(sheet), tS = night(rowsS);
    ok(tS.entry && tS.entry.ready, "drafts lost: the night still prepares the month (part 1 of 2 in the books by its own narration)");
    const w2 = wire(world(rowsS, { sheet, allocs: f.allocs(), pv: f.pv() }), f);
    const r = await w2.run(tS.entry);
    ok(r.ok && once(f, 150) && f.tally.length === 2 && w2.drafts["dc-tp-202610-c1-1"] && w2.drafts["dc-tp-202610-c1-1"].results["dc-tp-202610-c1-1"].ok, "  Approve: part 1 counted as in Tally from its FinCom id (a draft made for it); only part 2 posted; everyone once");
    const tD = night(f.books(sheet), { draftRecs: [] });
    f.sync();
    ok(!night(f.books(sheet)).entry && tD.entry, "  the night counts the month done from the two FinCom ids in the books (no drafts needed)");
  }
  // drafts lost, the books here not read since, Approve on another computer (Y: no record of part 1): Tally's copy in the
  // cloud has part 1's FinCom id; only part 2 posted
  {
    const f = fake();
    const w = wire(world(rows, { sheet, closeAt: (d) => d.id === "dc-tp-202610-c1-2" && d.state === "posting" }), f);
    try { await w.run(t.entry); } catch (x) { /* the page closed */ }
    f.sync(); f.via = "Y";
    const w2 = wire(world(rows, { sheet }), f);
    const r = await w2.run(t.entry);
    ok(r.ok && once(f, 150) && f.tally.length === 2 && !f.rec.Y.has("dc-tp-202610-c1-1"), "drafts lost, the books here behind: part 1 counted from FinCom's id in Tally's copy; never sent again through Y; everyone once");
  }
}

console.log("sixth review: the part's own day read from Tally (tally_days.at), released resends, one computer key");
{
  const fake = () => {
    const f = { tally: [], rec: { X: new Map(), Y: new Map() }, via: "X", copy: { dayAt: {}, snap: new Map() }, honoured: new Set(), lose: false };
    f.post = (v, rel) => { const r = f.rec[f.via], x = [].concat(rel || []).find((y) => y && y.id === v.id && y.at && !f.honoured.has(y.at + "|" + y.id));
      if (r.has(v.id) && !x) return { id: v.id, ok: false, alreadySent: true, message: "Already sent from this computer: not sent again" };
      if (x) f.honoured.add(x.at + "|" + x.id);
      r.set(v.id, v.xml); if (f.lose) return null; f.tally.push({ id: v.id, xml: v.xml }); return { id: v.id, ok: true, created: 1, vchId: String(f.tally.length) }; };
    f.sync = () => { f.tally.forEach((t) => f.copy.snap.set(t.id, t.xml)); f.copy.dayAt["2026-10-31"] = FRESH; };
    f.other = () => { f.copy.dayAt["2026-11-20"] = FRESH; };
    f.readMonth = async (cid, ym, days) => ({ readAt: Object.values(f.copy.dayAt).sort().pop() || STALE, dayAt: Object.fromEntries((days || []).filter((d) => f.copy.dayAt[d]).map((d) => [d, f.copy.dayAt[d]])),
      parts: Object.fromEntries(Array.from(f.copy.snap).map(([id, xml]) => [id, { found: true, no: "1", narr: (xml.match(/<NARRATION>([^<]*)/) || [])[1], employees: TPost.readVoucherXml(xml).employees }])) });
    f.paid = () => f.tally.flatMap((t) => TPost.readVoucherXml(t.xml).employees.map((e) => e.name));
    return f;
  };
  // (straight to the bridge on the posting computer: the release travels in the payload)
  const wire = (w, f) => { w.env.g.TCloud = { on: () => true, has: () => false, book: () => ({ book: "b1" }) };
    Object.defineProperty(w.env.g.Bridge, "st", { get: () => ({ version: "2.5.18", computer: "PC-" + f.via, bridgeId: f.via }), configurable: true });
    w.env.g.Bridge.post = async (pl) => { w.posts.push(pl); const x = f.post(pl.vouchers[0], pl.released); return { ok: true, results: x ? [x] : [] }; }; w.env.readMonth = f.readMonth; return w; };
  const sheet = many(150), rows = rowsOf({ sheet }), t = night(rows);
  const once = (f, n) => { const p = f.paid(); return p.length === n && new Set(p).size === n; };
  // the blocker (probe L2): part 1 reaches Tally through X, its answer lost; ANOTHER day is read (tally_books.days_at
  // moves), the month-end is not; the queue now on Y
  {
    const f = fake();
    const w = wire(world(rows, { sheet, closeAt: (d) => d.id === "dc-tp-202610-c1-1" && d.state === "posted" }), f);
    try { await w.run(t.entry); } catch (x) { /* the page closed */ }
    f.other(); f.via = "Y";
    const w2 = wire(world(rows, { sheet, drafts: JSON.parse(JSON.stringify(w.drafts)) }), f);
    let r = await w2.run(t.entry);
    ok(!r.ok && /older than this send/.test(String(r.why)) && f.tally.length === 1 && !f.rec.Y.size && w2.drafts["dc-tp-202610-c1-1"].sent.answered !== "gone", "blocker: another day read, the month-end not: waits; nothing through Y (100 would be paid twice)");
    f.sync();
    const w3 = wire(world(rows, { sheet, drafts: JSON.parse(JSON.stringify(w2.drafts)) }), f);
    r = await w3.run(t.entry);
    ok(r.ok && once(f, 150) && f.tally.length === 2, "  the month-end read since: part 1 found in Tally; only part 2 posted; everyone once");
    // a part settled "not in Tally" with no day-level proof (an older record) keeps its computer
    const xa = TP.payrollVoucherXml(TPost.prepare({ co: rows.co, ym: YM, rows: sheet, pay: payOf(sheet), ledgers: rows.ledgers.map((l) => l.name), books: {} }).vouchers[0]);
    const f2 = fake(); f2.via = "Y"; f2.rec.X.set("dc-tp-202610-c1-1", xa); f2.tally.push({ id: "dc-tp-202610-c1-1", xml: xa });
    const gone = { "dc-tp-202610-c1-1": { id: "dc-tp-202610-c1-1", dedupe: "payroll:202610", part: 1, parts: 2, state: "failed", sent: { xml: xa, at: "2026-11-22T10:00:00Z", via: "bridge:X", answered: "gone" }, results: { "dc-tp-202610-c1-1": { ok: false, state: "failed", said: "not in Tally" } }, vouchers: [{ xml: xa, date: "2026-10-31" }] } };
    const w4 = wire(world(rows, { sheet, drafts: gone }), f2);
    r = await w4.run(t.entry);
    ok(!r.ok && /goes again only through that computer/.test(String(r.why)) && f2.tally.length === 1 && !f2.rec.Y.size, "  a part settled “not in Tally” without its day read: never handed to Y");
  }
  // the dead end: X records the send, Tally never gets it, X answers "already sent" (identical, no job): posted, not confirmed
  {
    const f = fake();
    f.lose = true;
    const w = wire(world(rows, { sheet, closeAt: (d) => d.id === "dc-tp-202610-c1-1" && d.state !== "posting" }), f);
    try { await w.run(t.entry); } catch (x) { /* the page closed */ }
    f.lose = false;
    const xs = TP.payrollVoucherXml(TPost.prepare({ co: rows.co, ym: YM, rows: sheet, pay: payOf(sheet), ledgers: rows.ledgers.map((l) => l.name), books: {} }).vouchers[0]);
    const sentAt = new Date(Date.now() - 3600e3).toISOString();
    const unc = () => ({ "dc-tp-202610-c1-1": { id: "dc-tp-202610-c1-1", dedupe: "payroll:202610", part: 1, parts: 2, state: "posted", sent: { xml: xs, at: sentAt, via: "bridge:X", answered: "ok" }, results: { "dc-tp-202610-c1-1": { ok: true, state: "posted", unconfirmed: true, tallyId: "", at: sentAt } }, vouchers: [{ xml: xs, date: "2026-10-31" }] } });
    ok(f.rec.X.has("dc-tp-202610-c1-1") && !f.tally.length, "dead end: X recorded part 1, Tally never got it");
    let w2 = wire(world(rows, { sheet, drafts: unc() }), f);
    let r = await w2.run(t.entry);
    ok(!r.ok && /older than this send/.test(String(r.why)) && !f.tally.length && !w2.log.includes("entry_approved"), "  posted without a Tally id, its day not read since: waits (never counted done; the month never approved with 100 unpaid)");
    let tn = night(rows, { draftRecs: asRecs(unc()) });
    ok(!tn.entry && !journals(tn.inp).findings.some((x) => x.kind === "sent_check"), "  the night: waits too (no 24-hour rule)");
    f.sync();
    w2 = wire(world(rows, { sheet, drafts: unc() }), f);
    r = await w2.run(t.entry);
    ok(!r.ok && /Not confirmed in Tally: part 1/.test(String(r.why)) && /Day Book/.test(String(r.why)) && !f.tally.length, "  its day read since, the id not there: Approve refuses “Not confirmed in Tally: check Tally (Day Book)”");
    const rowsD = Object.assign({}, rows, { days: [{ day: "2026-10-31", at: FRESH }] });
    tn = night(rowsD, { draftRecs: asRecs(unc()) });
    const sc = journals(tn.inp).findings.find((x) => x.kind === "sent_check");
    ok(!tn.entry && sc && sc.key === "sent:payroll:202610:" + sentAt, "  the night raises “Not confirmed in Tally” at once (sent_check " + (sc && sc.key) + ")");
    const prior = [{ kind: "sent_check", key: (sc || {}).key || "sent:payroll:202610:" + sentAt, state: "resolved", evidence: [{ t: "retry", ref: "retry:payroll:202610" }], undone: false }];
    tn = night(rowsD, { draftRecs: asRecs(unc()), prior });
    ok(tn.entry && tn.entry.ready, "  the owner said “Not in Tally: offer it again”: the night prepares the month again");
    w2 = wire(world(rows, { sheet, drafts: unc(), prior }), f);
    w2.env.prior = prior;
    r = await w2.run(tn.entry);
    const p1 = w2.posts.find((pl) => pl.vouchers[0].id === "dc-tp-202610-c1-1");
    ok(r.ok && once(f, 150) && f.tally.length === 2 && !p1 && w2.posts.length === 2 && w2.posts.every((pl) => !pl.released && pl.vouchers[0].id !== "dc-tp-202610-c1-1") && w2.drafts["dc-tp-202610-c1-1"].retiredBy,
      "  Approve (eighth review): part 1 retired, its people posted under fresh ids (" + w2.posts.map((pl) => pl.vouchers[0].id).join(", ") + "), nothing released; Tally gets them; everyone once");
    // the copy later shows the id: in Tally
    const f3 = fake(); f3.rec.X.set("dc-tp-202610-c1-1", xs); f3.tally.push({ id: "dc-tp-202610-c1-1", xml: xs }); f3.sync();
    const w3 = wire(world(rows, { sheet, drafts: unc() }), f3);
    r = await w3.run(t.entry);
    ok(r.ok && once(f3, 150) && f3.tally.length === 2 && w3.drafts["dc-tp-202610-c1-1"].results["dc-tp-202610-c1-1"].tallyId, "  posted without a Tally id, later in Tally's copy: in Tally; only part 2 posted");
  }
  // one computer key: the bridge's own id on the cloud's queue and straight to the bridge alike
  {
    const viaCloud = TPost.postingBridge({ id: "c1" }, { TCloud: { on: () => true, has: () => true, postThrough: () => ({ id: "go-abc", computer: "PC-1", user: "u" }) } });
    const here = TPost.postingBridge({ id: "c1" }, { Bridge: { st: { version: "2.5.18", computer: "PC-1", user: "u" }, cfg: () => ({ bridgeId: "go-abc" }) } });
    ok(viaCloud.id === "bridge:go-abc" && here.id === viaCloud.id, "one computer key on both paths (" + here.id + ")");
  }
  // the night reads the count of parts back from the builder's own words
  {
    const pp = TPost.prepare({ co: rows.co, ym: YM, rows: many(250), pay: payOf(many(250)), ledgers: rows.ledgers.map((l) => l.name), books: {} }).vouchers;
    ok(pp.length === 3 && pp.every((v) => partsIn(v.narration) === 3 && PART_OF_RE.test(v.narration)), "the builder's narration (“…, part i of 3)”) is what the night reads back (tpparts.js)");
  }
}

console.log("seventh review: through FinCom's cloud queue (the bridge's releases come only from the posting it takes)");
{
  // the cloud's queue as migrations 32-203 and tally-ingest make it (the SQL route itself: tests/run_payroll_cloud_resend.py):
  // a posting per Bridge.post (CloudPost.run tells its id first); the bridge on the posting computer keeps its own record
  // (with the posting's id: sentJob) and honours only the releases of the posting it takes (tally_post_ids released by a
  // member); tally_post_owner_release; a Retry (tally_post_enqueue with the posting's id) of a failed posting only
  const cloud = () => {
    const q = { tally: [], rec: new Map(), honoured: new Set(), jobs: new Map(), ids: [], lose: false, held: false, calls: [], copy: { dayAt: {}, snap: new Map() }, n: 0 };
    const take = (j) => {
      const v = j.payload.vouchers[0], rel = q.ids.filter((r) => r.job_id === j.id && r.released_by === "owner").map((r) => ({ id: r.fincom_id, at: r.released_at, by: "owner", why: r.why }));
      const x = rel.find((y) => y.id === v.id && !q.honoured.has(y.at + "|" + y.id)), had = q.rec.get(v.id);
      let res;
      if (had && !x) res = { id: v.id, ok: false, alreadySent: true, refused: true, sent: true, state: "failed", sentJob: had.job, message: "already sent from this computer" };
      else { if (x) q.honoured.add(x.at + "|" + x.id); q.rec.set(v.id, { xml: v.xml, job: j.id });
        if (q.lose || (q.loseIds && q.loseIds.has(v.id))) res = { id: v.id, ok: false, sent: true, state: "failed", message: "Tally did not answer" };
        else { q.tally.push({ id: v.id, xml: v.xml }); res = { id: v.id, ok: true, created: 1, vchId: String(q.tally.length) }; } }
      j.results = (j.results || []).concat([res]); j.status = res.ok ? "done" : "failed"; j.taken_by = "go-x";
      return res;
    };
    q.post = async (pl, progress) => {
      const id = "00000000-0000-4000-8000-00000000000" + (++q.n), v = pl.vouchers[0];
      const j = { id, status: "waiting", payload: { vouchers: [v] }, results: [], company: pl.company, created_at: "2026-11-23T0" + q.n + ":00:00Z" };
      q.jobs.set(id, j); q.ids.push({ job_id: id, fincom_id: v.id, client_id: pl.client, created_at: j.created_at });
      progress && progress({ done: 0, total: 1, job: id });
      if (q.held) return { ok: true, results: [{ id: v.id, ok: false, held: true, job: id, message: "Waiting for Tally" }], job: { id, status: "waiting" } };
      const res = take(j);
      return { ok: true, results: [res], job: { id, status: j.status }, viaCloud: true };
    };
    q.rpc = async (fn, a) => { q.calls.push(fn + " " + (a.p_id || "") + (a.p_job ? " " + a.p_job : ""));
      if (fn === "tally_post_owner_release") { const j = q.jobs.get(a.p_job); if (!j) return { ok: false, error: "not found" };
        if (["waiting", "taken", "running"].includes(j.status)) return { ok: false, error: "This posting is still being sent to Tally; wait for it to finish, then settle the entry." };
        q.ids.filter((r) => r.job_id === a.p_job && r.fincom_id === a.p_id).forEach((r) => { r.released_by = "owner"; r.released_at = new Date().toISOString(); r.why = a.p_why; });
        return { ok: true, released: true }; }
      if (fn === "tally_post_enqueue") { const j = q.jobs.get(a.p_id); if (!j) return { ok: false, error: "new postings go through Bridge.post here" };
        if (!["failed", "cancelled"].includes(j.status)) return { ok: true, id: j.id, again: true };
        j.status = "waiting"; take(j); return { ok: true, id: j.id, retry: true }; }
      return { ok: true }; };
    q.api = async (path) => { const s = decodeURIComponent(String(path));
      if (s.startsWith("tally_post_ids")) { const fid = (s.match(/fincom_id=eq\.([^&]+)/) || [])[1]; return q.ids.filter((r) => r.fincom_id === fid).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
      if (s.startsWith("tally_post_jobs")) { const ids = ((s.match(/id=(?:in\.\(([^)]*)\)|eq\.([^&]+))/) || []).slice(1).find(Boolean) || "").split(","); return ids.map((x) => q.jobs.get(x)).filter(Boolean).map((j) => JSON.parse(JSON.stringify(j))); }
      return []; };
    q.sync = () => { q.tally.forEach((t) => q.copy.snap.set(t.id, t.xml)); q.copy.dayAt["2026-10-31"] = FRESH; };
    q.readMonth = async (cid, ym, days) => ({ readAt: Object.values(q.copy.dayAt).sort().pop() || STALE, dayAt: Object.fromEntries((days || []).filter((d) => q.copy.dayAt[d]).map((d) => [d, q.copy.dayAt[d]])),
      parts: Object.fromEntries(Array.from(q.copy.snap).map(([id, xml]) => [id, { found: true, no: "1", narr: (xml.match(/<NARRATION>([^<]*)/) || [])[1], employees: TPost.readVoucherXml(xml).employees }])) });
    q.paid = () => q.tally.flatMap((t) => TPost.readVoucherXml(t.xml).employees.map((e) => e.name));
    return q;
  };
  const wire = (w, q) => { w.env.g.TCloud = { on: () => true, has: () => true, book: () => ({ book: "b1" }), postThrough: () => ({ version: "2.5.18", computer: "PC-X", id: "go-x" }), rpc: q.rpc };
    w.env.g.Bridge.post = async (pl, progress) => { w.posts.push(pl); return q.post(pl, progress); };
    w.env.g.Cloud = { api: q.api }; w.env.g.payrollSleep = async () => {}; w.env.readMonth = q.readMonth; return w; };
  const sheet = many(150), rows = rowsOf({ sheet }), t = night(rows);
  const once = (q, n) => { const p = q.paid(); return p.length === n && new Set(p).size === n; };
  for (const lostJob of [false, true]) {
    // X records part 1 (with its posting), Tally never gets it, the page closes before the answer is saved
    const q = cloud(); q.lose = true;
    const w = wire(world(rows, { sheet, closeAt: (d) => d.id === "dc-tp-202610-c1-1" && d.state !== "posting" }), q);
    try { await w.run(t.entry); } catch (x) { /* the page closed */ }
    q.lose = false;
    const d0 = JSON.parse(JSON.stringify(w.drafts));
    const J1 = Array.from(q.jobs.keys())[0];
    if (lostJob) delete d0["dc-tp-202610-c1-1"].job;
    ok(q.rec.has("dc-tp-202610-c1-1") && !q.tally.length && (lostJob || d0["dc-tp-202610-c1-1"].job === J1), (lostJob ? "cloud, no posting id on record (an older draft): " : "cloud: ") + "X recorded part 1 in posting " + J1.slice(-2) + ", Tally never got it, the answer lost" + (lostJob ? "" : "; the posting's id kept the moment it was queued"));
    q.sync();
    const w2 = wire(world(rows, { sheet, drafts: d0 }), q);
    const r = await w2.run(t.entry);
    const ids = w2.posts.map((pl) => pl.vouchers[0].id), od = w2.drafts["dc-tp-202610-c1-1"];
    ok(q.calls.includes("tally_post_withdraw dc-tp-202610-c1-1 " + J1) && od.retiredBy && od.retiredBy.withdrawn === J1, "  ninth review: its earlier posting " + J1.slice(-2) + " withdrawn in the cloud's queue as it is retired (" + q.calls.join("; ") + ")");
    ok(r.ok && once(q, 150) && q.tally.length === 2 && JSON.stringify(ids) === '["dc-tp-202610-c1-2","dc-tp-202610-c1-3"]' && !q.calls.some((c) => /owner_release|tally_post_enqueue/.test(c)) && od.retiredBy && JSON.stringify(od.replacedBy) === JSON.stringify(ids),
      "  eighth review: its day read since, part 1 retired; the month posted as " + ids.join(", ") + " (part 1 of 2, part 2 of 2), nothing released or re-queued; everyone paid once");
    const pn = w2.posts.map((pl) => (pl.vouchers[0].xml.match(/part (\d+) of (\d+)\)/) || []).slice(1).join("/")).join(" ");
    ok(pn === "1/2 2/2", "  the new parts' narration: part 1 of 2, part 2 of 2 (" + pn + ")");
    if (!lostJob) {
      const tn = night(rowsOf({ sheet, vouchers: [] }), { draftRecs: asRecs(w2.drafts) });
      ok(!tn.entry, "  the night counts the month done: the two new parts in Tally, the retired id replaced (not missing, not counted)");
    }
  }
  for (const how of ["done", "sheet"]) {
    // (eighth review) the dead ends: the earlier posting ended "done" (Tally said created) though the part is not in Tally's
    // copy of its day read after the send; or the sheet changed since the send. Retired: posted under a fresh id
    const q = cloud();
    const w = wire(world(rows, { sheet, closeAt: (d) => d.id === "dc-tp-202610-c1-1" && d.state !== "posting" }), q);
    try { await w.run(t.entry); } catch (x) { /* the page closed */ }
    const J1 = Array.from(q.jobs.keys())[0];
    q.tally.length = 0;                                    // Tally said created, but the part is not in Tally (deleted, or never kept)
    if (how === "done") q.jobs.get(J1).status = "done";
    q.sync();
    const sheet2 = how === "sheet" ? sheet.map((x, i) => (i === 3 ? emp(x.name, 11000, 2000, { pt: 200 }) : x)) : sheet;
    const rows2 = rowsOf({ sheet: sheet2 }), t2 = night(rows2, { draftRecs: asRecs(w.drafts) });
    const w2 = wire(world(rows2, { sheet: sheet2, drafts: JSON.parse(JSON.stringify(w.drafts)) }), q);
    const r = await w2.run(t2.entry);
    const ids = w2.posts.map((pl) => pl.vouchers[0].id);
    ok(t2.entry && r.ok && once(q, 150) && !ids.includes("dc-tp-202610-c1-1") && w2.drafts["dc-tp-202610-c1-1"].retiredBy && !q.calls.some((c) => /owner_release|tally_post_enqueue/.test(c)),
      "cloud, " + (how === "done" ? "the earlier posting ended done" : "the sheet changed since the send") + ", part 1 not in Tally's copy of its day: retired, posted as " + ids.join(", ") + "; everyone paid once" + (r.ok ? "" : " (" + String(r.why).slice(0, 160) + ")"));
  }
  {
    // three parts: part 1 in Tally, part 2's answer lost (not in Tally), part 3 never sent: part 1 kept, part 2 retired;
    // the rest posted as the next free ids, numbered part 2 of 3 and part 3 of 3
    const sh = many(250), rw = rowsOf({ sheet: sh }), tw = night(rw);
    const q = cloud(); q.loseIds = new Set(["dc-tp-202610-c1-2"]);
    const w = wire(world(rw, { sheet: sh, closeAt: (d) => d.id === "dc-tp-202610-c1-2" && d.state !== "posting" }), q);
    try { await w.run(tw.entry); } catch (x) { /* the page closed */ }
    q.loseIds = null; q.sync();
    const w2 = wire(world(rw, { sheet: sh, drafts: JSON.parse(JSON.stringify(w.drafts)) }), q);
    const r = await w2.run(tw.entry);
    const got = w2.posts.map((pl) => pl.vouchers[0].id + " " + ((pl.vouchers[0].xml.match(/part (\d+) of (\d+)\)/) || []).slice(1).join("/"))).join(", ");
    ok(r.ok && once(q, 250) && got === "dc-tp-202610-c1-3 2/3, dc-tp-202610-c1-4 3/3" && w2.drafts["dc-tp-202610-c1-1"].parts === 3 && w2.drafts["dc-tp-202610-c1-2"].retiredBy,
      "a part in Tally kept, a lost one retired: the rest as " + got + "; everyone paid once");
    const tn = night(rw, { draftRecs: asRecs(w2.drafts) });
    ok(!tn.entry, "  the night counts the month done (3 parts in Tally, the retired one replaced)");
  }
  {
    // (ninth review) the withdrawal refused as the old posting is being sent: on its way, nothing retired or sent
    const q = cloud(); q.lose = true;
    const w = wire(world(rows, { sheet, closeAt: (d) => d.id === "dc-tp-202610-c1-1" && d.state !== "posting" }), q);
    try { await w.run(t.entry); } catch (x) { /* the page closed */ }
    q.lose = false; q.sync();
    const rpc0 = q.rpc; q.rpc = async (fn, a) => (fn === "tally_post_withdraw" ? { ok: false, busy: true, error: "This posting is still being sent to Tally; wait for it to finish." } : rpc0(fn, a));
    const w2 = wire(world(rows, { sheet, drafts: JSON.parse(JSON.stringify(w.drafts)) }), q);
    const r = await w2.run(t.entry);
    ok(!r.ok && /On its way/.test(String(r.why)) && !w2.posts.length && !w2.drafts["dc-tp-202610-c1-1"].retiredBy, "the old posting being sent when it would be withdrawn: on its way; nothing retired or sent");
  }
  for (const how of ["unanswered", "no212", "no212b"]) {
    // (tenth review) never retired: the posting a bridge took and never answered for (failed by the requeue alone); a
    // cloud without migration 212 (no tally_post_withdraw, or its second step not run)
    const q = cloud(); q.lose = true;
    const w = wire(world(rows, { sheet, closeAt: (d) => d.id === "dc-tp-202610-c1-1" && d.state !== "posting" }), q);
    try { await w.run(t.entry); } catch (x) { /* the page closed */ }
    q.lose = false; q.sync();
    const J1 = Array.from(q.jobs.keys())[0];
    if (how === "unanswered") q.jobs.get(J1).results = [];
    const rpc0 = q.rpc;
    if (how === "no212") q.rpc = async (fn, a) => { if (fn === "tally_post_withdraw") throw new Error("PGRST202: Could not find the function public.tally_post_withdraw in the schema cache"); return rpc0(fn, a); };
    if (how === "no212b") q.rpc = async (fn, a) => (fn === "tally_post_withdraw" ? { ok: false, error: "FinCom's cloud cannot withdraw an entry yet (migration 212's second step is not run)." } : rpc0(fn, a));
    const w2 = wire(world(rows, { sheet, drafts: JSON.parse(JSON.stringify(w.drafts)) }), q);
    const r = await w2.run(t.entry);
    const want = how === "unanswered" ? /the Tally computer that took it has not reported; open FinCom Bridge there first/ : /FinCom’s cloud is not ready for this yet/;
    ok(!r.ok && want.test(String(r.why)) && !w2.posts.length && !w2.drafts["dc-tp-202610-c1-1"].retiredBy && !q.tally.length,
      (how === "unanswered" ? "a posting its bridge took and never answered for" : how === "no212" ? "a cloud without tally_post_withdraw" : "a cloud without 212's second step") + ": waits, nothing retired or sent (" + String(r.why).slice(0, 90) + "…)");
  }
  {
    // the queue's refusal as a piece of its SQL: plain words
    const q = cloud();
    const w = wire(world(rows, { sheet }), q);
    w.env.g.Bridge.post = async () => { throw new Error("ERROR: '::jsonb), 'vouchers', vs, 'ledger', coalesce(p_payload->>'ledger', '')), n,\nPL/pgSQL function tally_post_enqueue_core(uuid,text,jsonb,uuid,text) line 95 at SQL statement"); };
    const r = await w.run(t.entry);
    ok(!r.ok && /FinCom’s cloud did not queue part 1: an earlier posting of it is still held there/.test(String(r.why)) && !/jsonb|PL\/pgSQL/.test(String(r.why)), "the queue's refusal in SQL words: said plainly (" + String(r.why).slice(0, 120) + ")");
  }
  {
    // the posting still waiting for Tally: on its way, never settled meanwhile
    const q = cloud(); q.held = true;
    const w = wire(world(rows, { sheet, closeAt: (d) => d.id === "dc-tp-202610-c1-1" && d.state !== "posting" }), q);
    try { await w.run(t.entry); } catch (x) { /* the page closed */ }
    q.sync();
    const d0 = JSON.parse(JSON.stringify(w.drafts)); delete d0["dc-tp-202610-c1-1"].job;
    const w2 = wire(world(rows, { sheet, drafts: d0 }), q);
    const r = await w2.run(t.entry);
    ok(!r.ok && /on its way/i.test(String(r.why)) && !q.tally.length && !q.calls.some((c) => /owner_release/.test(c)), "cloud: the earlier posting (found by FinCom's id) still waiting: on its way, nothing released or sent");
  }
}

console.log("seventh review: the book that holds the day, India's month-ends, a computer FinCom cannot name");
{
  // a split year: March 2026's payroll approved in April, the client's books 2026-27 (b26) and 2025-26 (b25)
  const asked = [], g = { TCloud: { st: { c1: { books: [{ book: "b26", from: "2026-04-01" }, { book: "b25", from: "2025-04-01" }] } }, book: () => ({ book: "b26" }) },
    Cloud: { api: async (p) => { asked.push(decodeURIComponent(p)); return /^tally_days/.test(p) ? [{ day: "2026-03-31", at: FRESH }] : []; } } };
  ok(TPost.bookFor(g, "c1", "2026-03-31") === "b25" && TPost.bookFor(g, "c1", "2026-04-30") === "b26", "the book that holds a day: March 2026 in 2025-26's book, April in 2026-27's");
  const m = await TPost.readMonth("c1", "202603", ["2026-03-31"], g);
  ok(m && m.dayAt["2026-03-31"] === FRESH && asked.some((x) => /^tally_days.*book_id=eq\.b25&day=in\.\(2026-03-31\)/.test(x)) && asked.some((x) => /^tally_vouchers.*book_id=in\.\(b25\)/.test(x)) && !asked.some((x) => /b26/.test(x)),
    "  Tally's copy of March read from 2025-26's book (" + asked.map((x) => x.split("?")[0]).join(", ") + ")");
  ok(JSON.stringify(monthEndsIST(new Date("2026-10-31T20:00:00Z"), 2)) === '["2026-11-30","2026-10-31"]' && JSON.stringify(monthEndsIST(new Date("2026-10-31T17:00:00Z"), 1)) === '["2026-10-31"]',
    "the night's month-ends in India's time (31-Oct 20:00 UTC is 1-Nov in India)");
  const picked = daysOfBooks([{ book_id: "b26", from_date: "2026-04-01" }, { book_id: "b25", from_date: "2025-04-01" }], [{ book_id: "b26", day: "2026-03-31", at: FRESH }, { book_id: "b25", day: "2026-03-31", at: STALE }, { book_id: "b26", day: "2026-04-30", at: FRESH }]);
  ok(JSON.stringify(picked) === JSON.stringify([{ day: "2026-03-31", at: STALE }, { day: "2026-04-30", at: FRESH }]), "  each day's read time from the book that holds it (a later book's row for March ignored)");
  // straight to the bridge, the bridge here naming no id: a part sent before waits (never sent on a guess)
  const rows = rowsOf(), e = night(rows).entry;
  const xs = TP.payrollVoucherXml(TPost.prepare({ co: rows.co, ym: YM, rows: SHEET, pay: payOf(SHEET), ledgers: rows.ledgers.map((l) => l.name), books: {} }).vouchers[0]);
  const w = world(rows, { drafts: { "dc-tp-202610-c1-1": { id: "dc-tp-202610-c1-1", dedupe: "payroll:202610", part: 1, parts: 1, state: "failed", sent: { xml: xs, at: "2026-11-22T10:00:00Z", answered: "gone" }, results: { "dc-tp-202610-c1-1": { ok: false, state: "failed" } }, vouchers: [{ xml: xs }] } }, readMonth: notIn });
  const r = await w.run(e);
  ok(!r.ok && !w.posts.length && /goes again only through that computer/.test(String(r.why)), "a part settled “not in Tally” without its day read, no computer on record and none named here: waits, nothing sent");
}

console.log("ninth review: a retired part's old posting never goes again");
{
  // the Post page: Retry of a failed posting holding a Tally Payroll part is refused (src/js/59-post-owner.js, lazy)
  const vm = await import("node:vm"), fs = await import("node:fs");
  const ctx = { S: { data: { c1: { loaded: true, entries: {} } }, bank: null }, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL("../src/js/59-post-owner.js", import.meta.url), "utf8") + ";globalThis.__PO = PostOwner;", ctx);
  const no = ctx.__PO.retryChanged({ client_id: "c1", id: "j1", status: "failed" }, ["dc-tp-202610-c1-1"], {});
  ok(/Retry not possible: this is part of a Tally Payroll month \(dc-tp-202610-c1-1\)/.test(no) && /pay twice/.test(no), "the Post page: “Post again” of a posting holding a Tally Payroll part refused (" + no.slice(0, 80) + "…)");
  ok(ctx.__PO.retryChanged({ client_id: "c1", id: "j2", status: "failed" }, ["b1"], { b1: { status: "approved", x: {} } }) === "", "  a bill's posting as before");
  // the night: a retired id that shows up in Tally is Needs you, never counted toward done
  const xs = TP.payrollVoucherXml(TPost.prepare({ co: rowsOf().co, ym: YM, rows: SHEET, pay: payOf(SHEET), ledgers: rowsOf().ledgers.map((l) => l.name), books: {} }).vouchers[0]);
  const v = TPost.readVoucherXml(xs), xt = inTally({ id: "dc-tp-202610-c1-1", narration: "Salary for Oct 2026 as per the salary sheet (3 employees)", payable: v.payable, net: v.net, employees: v.employees }, "g1");
  const drafts = { "dc-tp-202610-c1-1": { id: "dc-tp-202610-c1-1", dedupe: "payroll:202610", part: 1, parts: 1, state: "failed", retiredBy: { at: "x" }, replacedBy: ["dc-tp-202610-c1-2"], sent: { xml: xs, answered: "gone", dayGone: "2026-10-31" }, results: { "dc-tp-202610-c1-1": { ok: false, state: "failed" } } },
    "dc-tp-202610-c1-2": { id: "dc-tp-202610-c1-2", dedupe: "payroll:202610", part: 1, parts: 1, state: "posted", results: { "dc-tp-202610-c1-2": { ok: true, state: "posted", tallyId: "9" } } } };
  const tn = night(rowsOf({ vouchers: [xt.voucher] }), { draftRecs: asRecs(drafts) });
  const f = (tn.finding || {}).facts || {};
  ok(!tn.entry && tn.finding && tn.finding.state === "you" && /set aside as not in Tally/.test(String(f.title)) && /dc-tp-202610-c1-1/.test(String(f.title)), "the night: a retired part in Tally after all is Needs you (" + String(f.title).slice(0, 90) + "…)");
}

console.log("212 re-review: a part's id carries its client");
{
  const one = (cid) => TPost.prepare({ co: Object.assign({}, rowsOf().co, { id: cid }), ym: YM, rows: SHEET, pay: payOf(SHEET), ledgers: rowsOf().ledgers.map((l) => l.name), books: {} }).vouchers[0];
  const a = one("c1"), b = one("cmwstg-River_9");
  ok(a.id === "dc-tp-202610-c1-1" && b.id === "dc-tp-202610-cmwstgriver9-1" && TP.payrollVoucherXml(b).includes("TDSDesk:dc-tp-202610-cmwstgriver9-1</NARRATION>"), "two clients' part 1: dc-tp-202610-c1-1 and dc-tp-202610-cmwstgriver9-1 (the tag in the narration carries the client)");
  // one Tally computer posting for two clients: its record (posted-ids.json, by the tag alone) never refuses the second
  const rec = new Map(), tally = [];
  const post = (rows, cid) => { const w = world(rows); w.env.g.Bridge.post = async (pl) => { w.posts.push(pl); const v = pl.vouchers[0], k = (v.xml.match(/TDSDesk:([A-Za-z0-9._-]+)/) || [])[1].replace(/[^A-Za-z0-9]/g, "");
    if (rec.has(k)) return { ok: true, results: [{ id: v.id, ok: false, alreadySent: true, message: "Already sent from this computer: not sent again" }] }; rec.set(k, 1); tally.push(cid); return { ok: true, results: [{ id: v.id, ok: true, created: 1, vchId: String(tally.length) }] }; }; return w; };
  const r1 = rowsOf(), r2 = Object.assign(rowsOf({ co: { id: "c2" } }), { client: "c2" });
  const x1 = await post(r1, "c1").run(night(r1).entry), x2 = await post(r2, "c2").run(night(r2).entry);
  ok(x1.ok && x2.ok && JSON.stringify(tally) === '["c1","c2"]', "one Tally computer, two clients' October: both posted, neither refused as \"already sent\" (" + String(x2.words || x2.why).slice(0, 80) + ")");
  // the night reads the client's own ids (and an older one with no client) from the books
  ok(tpIdRe("202610", "c1").test("Salary | TDSDesk:dc-tp-202610-c1-2") && tpIdRe("202610", "c1").test("Salary | TDSDesk:dc-tp-202610-2") && !tpIdRe("202610", "c1").test("Salary | TDSDesk:dc-tp-202610-c2-2"), "  the night reads the client's own part ids (an older one with no client too), never another client's");
}

console.log("the drafts the night reads carry the parts");
{
  const d = draftsOf([{ item: "#dc-tp-202610-c1-1", data: { id: "dc-tp-202610-c1-1", dedupe: "payroll:202610", parts: 2, state: "posted", results: { "dc-tp-202610-c1-1": { ok: true, tallyId: "9" } } } }], {}, [], Date.now());
  ok(d.length === 1 && d[0].parts === 2 && d[0].state === "posted", "nightinput draftsOf: a part's count of parts");
  const one = payrollOne(YM, SHEET, Object.assign({}, night(rowsOf()).inp, { drafts: [{ vid: "dc-tp-202610-c1-1", dedupe: "payroll:202610", state: "live", parts: 1 }] }));
  ok(one === null, "a part on its way to Tally: nothing prepared tonight (waited for)");
}

console.log(fails ? "\n" + fails + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fails ? 1 : 0);
