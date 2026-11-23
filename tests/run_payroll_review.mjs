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
import { earningHead } from "../server/_shared/nightchecks.js";
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
const monthOf = (fn, readAt = FRESH, n = 1) => async (cid, ym) => { const parts = {}; for (let i = 1; i <= n; i++) { const id = "dc-tp-" + ym + "-" + i, t = await fn(cid, id); if (t && (t.found || t.deleted)) parts[id] = t; } return { readAt, parts }; };
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
  ok(!r.ok && w.posts.map((p) => p.vouchers[0].id).join() === "dc-tp-202610-1,dc-tp-202610-2" && w.log.includes("entry_release"), "the real second check passes; part 1 posted, part 2 refused, released");
  const i1 = w.log.indexOf("post dc-tp-202610-1"), i2 = w.log.indexOf("post dc-tp-202610-2"), saves = w.log.filter((l) => /^save/.test(l));
  ok(w.log.slice(0, i1).filter((l) => /^save/.test(l)).join() === "save dc-tp-202610-1 posting,save dc-tp-202610-2 waiting" && w.log.slice(i1, i2).filter((l) => /^save/.test(l)).join() === "save dc-tp-202610-1 posted,save dc-tp-202610-2 waiting,save dc-tp-202610-2 posting"
    && saves[saves.length - 1] === "save dc-tp-202610-2 failed",
    "third review: part 2 saved waiting before part 1 is sent; part 1's answer saved straight after it, then part 2 waiting again: " + saves.join(" > "));
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
  const odd = JSON.parse(JSON.stringify(w.drafts)); odd["dc-tp-202610-1"].vouchers[0].xml = odd["dc-tp-202610-1"].sent.xml = odd["dc-tp-202610-1"].sent.xml.replace("Made Up Person 000", "Made Up Person 149");
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
  // (third, fifth reviews) the posting computer's record ("already sent") and "already in Tally" count only when FinCom's
  // record of the earlier send is this very XML
  const v6 = TPost.prepare({ co: rows6.co, ym: YM, rows: SHEET, pay: payOf(SHEET), ledgers: rows6.ledgers.map((l) => l.name), books: {} }).vouchers[0], x6 = TP.payrollVoucherXml(v6);
  const lost = (xml) => ({ "dc-tp-202610-1": { id: "dc-tp-202610-1", dedupe: "payroll:202610", kind: "tallyPayroll", part: 1, parts: 1, state: "posting", sent: { xml, at: "2026-11-22T10:00:00Z" }, results: { "dc-tp-202610-1": { ok: false, state: "sent" } }, vouchers: [{ xml }] } });
  let w6 = world(rows6, { drafts: lost(x6), readMonth: notIn, answer: (v) => ({ id: v.id, ok: false, alreadySent: true, sentJob: "job-77", message: "Already sent from this computer (job job-77): not sent again" }) });
  let r6 = await w6.run(e6);
  ok(r6.ok && r6.queued && /on its way to Tally \(sent before; not sent again\)/.test(r6.words) && !w6.log.includes("entry_release") && w6.drafts["dc-tp-202610-1"].job === "job-77", "6: alreadySent for the very XML sent before: on its way (its job kept), not failed, not released");
  w6 = world(rows6, { answer: (v) => ({ id: v.id, ok: false, alreadySent: true, sentJob: "job-77", message: "Already sent from this computer (job job-77): not sent again" }) });
  r6 = await w6.run(e6);
  ok(!r6.ok && /sent part 1 before with other contents/.test(r6.why) && w6.log.includes("entry_release"), "  fifth review: alreadySent with no record of that XML: refused, released (never taken as on its way)");
  const has41 = async () => ({ found: true, no: "41", employees: TPost.readVoucherXml(x6).employees });
  w6 = world(rows6, { drafts: lost(x6), readMonth: notIn, answer: (v) => ({ id: v.id, ok: false, message: "Already in Tally (voucher no. 41)" }) });
  r6 = await w6.run(e6);
  ok(r6.ok && /already in Tally \(not sent again\)/.test(r6.words) && w6.drafts["dc-tp-202610-1"].results["dc-tp-202610-1"].tallyId === "41", "  an unanswered send not in Tally's copy yet: sent again as the same XML; Tally says already there (no. 41): in Tally");
  w6 = world(rows6, { drafts: lost(x6), readMonth: monthOf(has41) });
  r6 = await w6.run(e6);
  ok(r6.ok && !w6.posts.length && /already in Tally/.test(r6.words) && w6.drafts["dc-tp-202610-1"].results["dc-tp-202610-1"].tallyId === "41", "  fourth review: an unanswered send found in Tally's copy with the same figures: in Tally, not sent again");
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
  ok(r1.ok && w1.posts.length === 1 && w1.posts[0].vouchers[0].id === "dc-tp-202610-2", "  and Approve posts part 2");
}

console.log("re-review 2: the resend guard's answer with no job");
{
  // (fifth review) the very XML sent before from that computer (its send unanswered, not in a copy read after it)
  const rows = rowsOf(), e = night(rows).entry;
  const xs = TP.payrollVoucherXml(TPost.prepare({ co: rows.co, ym: YM, rows: SHEET, pay: payOf(SHEET), ledgers: rows.ledgers.map((l) => l.name), books: {} }).vouchers[0]);
  const w = world(rows, { readMonth: notIn, drafts: { "dc-tp-202610-1": { id: "dc-tp-202610-1", dedupe: "payroll:202610", part: 1, parts: 1, state: "posting", sent: { xml: xs, at: "2026-11-22T10:00:00Z" }, results: { "dc-tp-202610-1": { ok: false, state: "sent" } }, vouchers: [{ xml: xs }] } },
    answer: (v) => ({ id: v.id, ok: false, alreadySent: true, message: "Already sent from this computer: not sent again" }) });
  const r = await w.run(e);
  const d = w.drafts["dc-tp-202610-1"], res = d.results["dc-tp-202610-1"];
  ok(r.ok && d.state === "posted" && res.ok && !res.tallyId && /Tally has not confirmed it yet/.test(r.words), "saved as posted without Tally's voucher id (not failed, not on its way to a job that is not there)");
  ok(draftState({ vid: d.id, dedupe: d.dedupe, state: d.state, results: d.results, at: res.at }, {}, Date.now()) === "pending", "  the 24-hour rule: pending now");
  const old = JSON.parse(JSON.stringify(d)); old.results[d.id].at = new Date(Date.now() - 26 * 3600e3).toISOString();
  const t = night(rows, { draftRecs: asRecs({ [d.id]: old }) });
  ok(!t.entry && t.inp && journals(t.inp).findings.some((f) => f.kind === "sent_check" && /not confirmed there after 24 hours/.test(f.facts.title)), "  after 24 hours: “Not confirmed in Tally” (Needs you)");
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
  ok(r.ok && w2.posts.length === 1 && w2.posts[0].vouchers[0].id === "dc-tp-202610-2" && (xs.match(/<EMPLOYEEENTRIES\.LIST>/g) || []).length === 50 && !/Made Up Person 0\d\d</.test(xs) && /part 2 of 2/.test(xs),
    "accepted: part 1 kept as it is in Tally; only the 50 employees not in it posted (part 2 of 2), nobody sent twice");
  ok(w2.drafts["dc-tp-202610-1"].accepted && w2.drafts["dc-tp-202610-1"].accepted.by === "Made-up Person", "  the acceptance kept on part 1's draft (who)");
  // amounts changed for someone in part 1: no accepting (the parts would not add up)
  const sheet2 = sheet.map((r, i) => (i === 0 ? emp(r.name, 10500, 2000, { pt: 200 }) : r)), rows2 = rowsOf({ sheet: sheet2, vouchers: [x.voucher] }), t2 = night(rows2, { draftRecs: asRecs(w.drafts) });
  const w3 = world(rows2, { sheet: sheet2, drafts: JSON.parse(JSON.stringify(w.drafts)), allocs: x.allocs, pv: x.pv });
  r = await w3.run(t2.entry);
  ok(t2.entry && !r.ok && r.stuck && !r.canAccept && /Made Up Person 000’s net \(₹11,800 in Tally, ₹12,300 now\)/.test(r.why) && /other amounts than the sheet/.test(r.why) && !w3.posts.length, "an amount changed in part 1: said, no accepting, nothing sent");
}

console.log("re-review 6: a part of FinCom's own not yet in the books here");
{
  const rows = rowsOf(), b = booksOf(rows), alloc = [{ guid: "ours", day: "20261031", head: "Basic Pay", employee: "Ravi Kumar", amt: -25000 }];
  let p = TPost.prepare({ co: rows.co, ym: YM, rows: SHEET, pay: payOf(SHEET, { allocs: alloc, pv: { ours: { day: "20261031", type: "Payroll", no: "3", narr: "Salary | TDSDesk:dc-tp-202610-1" } } }), ledgers: rows.ledgers.map((l) => l.name), books: b });
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
      closeAt: (d) => (lostAnswer ? d.id === "dc-tp-202610-1" && d.state === "posted" : d.id === "dc-tp-202610-2" && d.state === "posting") });
    let closed = false; try { await w.run(t.entry); } catch (x) { closed = /closed/.test(String(x && x.message)); }
    ok(closed && ty.T.size === 1, "the page closed " + words + ": part 1 in Tally, part 2 never sent");
    const p1 = TPost.readVoucherXml(ty.T.get("dc-tp-202610-1"));
    const x = inTally({ id: "dc-tp-202610-1", narration: (ty.T.get("dc-tp-202610-1").match(/<NARRATION>([^<|]*)/) || [])[1].trim(), payable: "Salary Payable", net: p1.net, employees: p1.employees.map((e) => ({ name: e.name, heads: e.heads })) }, "tp1");
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
  ok(!r.ok && w2.drafts["dc-tp-202610-1"].accepted && w2.drafts["dc-tp-202610-1"].parts === 3, "(b) accepted, the rest in two parts: part 1's draft says the month now has 3 parts");
  refuse = false; w2.run.extra = {};
  r = await w2.run(t0.entry);
  ok(r.ok && w2.posts.slice(-2).map((pl) => pl.vouchers[0].id).join() === "dc-tp-202610-2,dc-tp-202610-3", "(c) the same differences as accepted: not asked again; parts 2 and 3 posted");
  const tn = night(rowsOf({ sheet, vouchers: [x.voucher] }), { draftRecs: asRecs(w2.drafts) });
  ok(!tn.entry && !tn.finding, "(b) the night counts the month done (3 parts of 3)");
  const w3 = world(synced, { sheet, emps: sheet.map((r0, i) => ({ name: r0.name, category: i === 0 || i === 120 || i === 130 ? "Head Office" : "" })), drafts: JSON.parse(JSON.stringify(w.drafts)), allocs: x.allocs, pv: x.pv });
  const d1 = w3.drafts["dc-tp-202610-1"]; d1.accepted = JSON.parse(JSON.stringify(w2.drafts["dc-tp-202610-1"].accepted));
  r = await w3.run(t0.entry);
  ok(!r.ok && r.stuck && r.canAccept && !w3.posts.length, "(c) something else differs since the acceptance (another category moved): asked again, nothing sent");
  // (d) a part whose draft says unconfirmed but whose FinCom id is in the books: no "Not confirmed in Tally"
  const v1 = TPost.prepare({ co: rows.co, ym: YM, rows: SHEET, pay: payOf(SHEET), ledgers: rows.ledgers.map((l) => l.name), books: {} }).vouchers[0], xi = inTally(v1, "tq1");
  const dr = { "dc-tp-202610-1": { id: "dc-tp-202610-1", dedupe: "payroll:202610", parts: 1, part: 1, state: "posted", results: { "dc-tp-202610-1": { ok: true, at: new Date(Date.now() - 30 * 3600e3).toISOString() } } } };
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
  const draft = (sent) => ({ "dc-tp-202610-1": { id: "dc-tp-202610-1", dedupe: "payroll:202610", kind: "tallyPayroll", part: 1, parts: 1, state: sent.unknown ? "failed" : "posting", sent, results: { "dc-tp-202610-1": { ok: false, state: sent.unknown ? "failed" : "sent", at: "2026-11-22T10:00:00Z" } }, vouchers: [{ xml: x1, date: "2026-10-31" }] } });
  // B: part 1 really in Tally with the old figures; the sheet changed since (Asha's basic)
  let w = world(rowsB, { sheet: sheetB, drafts: draft({ xml: x1, at: "2026-11-22T10:00:00Z" }), readMonth: monthOf(async () => ({ found: true, no: "7", employees: TPost.readVoucherXml(x1).employees })) });
  let r = await w.run(eB);
  ok(!r.ok && r.stuck && !w.posts.length && w.drafts["dc-tp-202610-1"].sent.answered === "ok" && /Asha Verma’s net/.test(r.why), "B: the unanswered send found in Tally (old figures): settled as in Tally, the change named, nothing sent: " + r.why.slice(0, 120));
  ok(!r.canAccept, "  (Asha's amount differs from the sheet: no accepting; correct Tally or the sheet)");
  w = world(rowsB, { sheet: sheetB, drafts: draft({ xml: x1, at: "2026-11-22T10:00:00Z" }), readMonth: monthOf(async () => ({ found: false, deleted: true })) });
  r = await w.run(eB);
  ok(r.ok && w.posts.length === 1 && /Asha Verma/.test(w.posts[0].vouchers[0].xml) && /<AMOUNT>-16000\.00<\/AMOUNT>/.test(w.posts[0].vouchers[0].xml), "B after part 1 is deleted in Tally: settled as not posted, the part built now posted");
  w = world(rowsB, { sheet: sheetB, drafts: draft({ xml: x1, at: "2026-11-22T10:00:00Z" }) });
  w.env.g.Cloud.api = async (path) => (/tally_post_jobs/.test(path) ? [{ id: "j9", status: "running" }] : []);
  w.drafts["dc-tp-202610-1"].job = "j9";
  r = await w.run(eB);
  ok(!r.ok && /on its way/i.test(r.why) && !w.posts.length, "  a posting of that part still running in the queue: waited for, never settled meanwhile");
  // C: Tally had it with no record of sending (sent unknown); then the voucher deleted in Tally
  w = world(rows, { drafts: draft({ xml: null, at: "", unknown: true }), readMonth: monthOf(async () => ({ found: true, no: "8", employees: TPost.readVoucherXml(x1).employees })) });
  r = await w.run(e);
  ok(r.ok && !w.posts.length && /already in Tally/.test(r.words), "C: in Tally with no record of sending: Tally's figures are the part built now: in Tally, nothing sent");
  w = world(rows, { drafts: draft({ xml: null, at: "", unknown: true }), readMonth: monthOf(async () => ({ found: false, deleted: true })) });
  r = await w.run(e);
  ok(r.ok && w.posts.length === 1 && w.drafts["dc-tp-202610-1"].results["dc-tp-202610-1"].ok, "C after the voucher is deleted in Tally: not posted, sent again, in Tally");
  // post as a journal this month, after settling: the night prepares the journal, Daily Check's approve settles first
  const rowsJ = rowsOf({ co: { payrollJournal: { [YM]: { by: "x" } } }, sheet: SHEET.map((r) => Object.assign({}, r, { ded: {}, otherDed: 0, net: r2(r.gross - r.tds - r.profTax - r.pf - r.esi) })), ledgers: { "TDS on Salary 192": "Duties & Taxes", "Professional Tax Payable": "Duties & Taxes", "PF Payable": "Duties & Taxes", "ESI Payable": "Duties & Taxes" } });
  const dj = draft({ xml: x1, at: new Date(Date.now() - 2 * 3600e3).toISOString() });
  rowsJ.book.days_at = new Date().toISOString();
  const picks = [["profTax", "Professional Tax Payable"], ["pf", "PF Payable"], ["esi", "ESI Payable"]].map(([k, l]) => ({ kind: "ledger_pick", key: "led:" + k, state: "resolved", evidence: [{ t: "ledger", ledger: l }], undone: false }));
  let tj = night(rowsJ, { draftRecs: asRecs(dj), prior: picks });
  ok(tj.entry && tj.entry.voucher.kind === "payroll", "journal this month: the night prepares the journal (the unanswered Tally Payroll part is not in a copy read after it)");
  const gj = { Cloud: { api: async () => [] }, TCloud: {} }, Aj = { Drafts: { save: async (cid, d) => { dj[d.id] = JSON.parse(JSON.stringify(d)); return true; } } };
  let st = await TPost.settleParts(rowsJ.co, tj.entry || { dedupe: "payroll:" + YM, voucher: { period: YM } }, Object.values(dj), {}, Aj, gj, { forJournal: true, readMonth: monthOf(async () => ({ found: false }), STALE) });
  ok(st.waits.length === 1 && /older than this send/.test(st.waits[0]) && dj["dc-tp-202610-1"].sent.answered !== "gone", "  fifth review: approving it with Tally's copy older than the send: waits (bridge 2.5.18 does not look in Tally)");
  st = await TPost.settleParts(rowsJ.co, tj.entry || { dedupe: "payroll:" + YM, voucher: { period: YM } }, Object.values(dj), {}, Aj, gj, { forJournal: true, readMonth: monthOf(async () => ({ found: false, deleted: true })) });
  ok(!st.waits.length && dj["dc-tp-202610-1"].state === "failed" && dj["dc-tp-202610-1"].sent.answered === "gone", "  a copy read after the send, the part not in it: settled as not posted");
  const okd = { "dc-tp-202610-1": Object.assign({}, dj["dc-tp-202610-1"], { state: "posted", sent: { xml: x1, answered: "ok" }, results: { "dc-tp-202610-1": { ok: true, state: "posted", tallyId: "7", at: new Date(Date.now() - 3 * 3600e3).toISOString() } } }) };
  rowsJ.book.days_at = new Date(Date.now() - 30 * 3600e3).toISOString();
  tj = night(rowsJ, { draftRecs: asRecs(okd), prior: picks });
  ok(!tj.entry, "  fifth review: a part posted in Tally, Tally's copy older than it: no journal (however long ago)");
  rowsJ.book.days_at = new Date().toISOString();
  tj = night(rowsJ, { draftRecs: asRecs(okd), prior: picks });
  ok(tj.entry && tj.entry.ready, "  a copy read after it, its FinCom id not in the books (deleted in Tally): the journal is prepared");
  st = await TPost.settleParts(rowsJ.co, tj.entry || { dedupe: "payroll:" + YM, voucher: { period: YM } }, Object.values(okd), {}, { Drafts: { save: async (cid, d) => { okd[d.id] = JSON.parse(JSON.stringify(d)); return true; } } }, gj, { forJournal: true, readMonth: monthOf(async () => ({ found: false, deleted: true })) });
  ok(okd["dc-tp-202610-1"].state === "failed", "  and Daily Check's Approve settles that part as not in Tally before the journal goes");
  st = await TPost.settleParts(rowsJ.co, { dedupe: "payroll:" + YM, voucher: { period: YM } }, [], {}, { Drafts: { save: async () => true } }, gj, { forJournal: true, readMonth: monthOf(async () => ({ found: true, no: "12", employees: TPost.readVoucherXml(x1).employees })) });
  ok(st.waits.length === 1 && /is in Tally \(voucher no\. 12\)/.test(st.waits[0]), "  fifth review: no drafts at all, part 1's FinCom id in Tally's copy: the journal is held back");
}

console.log("fifth review: a bridge as 2.5.18 is (its own record of what it sent, no look in Tally), a copy behind Tally");
{
  // bridge 2.5.18: each posting computer keeps the ids it sent (alreadySent); nothing looks in Tally, so Tally can hold the
  // same id twice. Tally's copy in FinCom's cloud is read in only when synced
  const fake = () => {
    const f = { tally: [], rec: { X: new Map(), Y: new Map() }, via: "X", copy: { readAt: STALE, snap: new Map() } };
    f.post = (v) => { const r = f.rec[f.via]; if (r.has(v.id)) return { id: v.id, ok: false, alreadySent: true, message: "Already sent from this computer: not sent again" }; r.set(v.id, v.xml); f.tally.push({ id: v.id, xml: v.xml }); return { id: v.id, ok: true, created: 1, vchId: String(f.tally.length) }; };
    f.sync = () => { f.tally.forEach((t) => f.copy.snap.set(t.id, t.xml)); f.copy.readAt = FRESH; };
    f.readMonth = async () => ({ readAt: f.copy.readAt, parts: Object.fromEntries(Array.from(f.copy.snap).map(([id, xml]) => [id, { found: true, no: "1", narr: (xml.match(/<NARRATION>([^<]*)/) || [])[1], employees: TPost.readVoucherXml(xml).employees }])) });
    f.paid = () => f.tally.flatMap((t) => TPost.readVoucherXml(t.xml).employees.map((e) => e.name));
    f.books = (sheet) => rowsOf({ sheet, vouchers: Array.from(f.copy.snap).map(([id, xml], i) => { const rv = TPost.readVoucherXml(xml); return inTally({ id, narration: (xml.match(/<NARRATION>([^<|]*)/) || [])[1].trim(), payable: rv.payable, net: rv.net, employees: rv.employees }, "g" + i).voucher; }) });
    f.allocs = () => Array.from(f.copy.snap).flatMap(([id, xml], i) => { const rv = TPost.readVoucherXml(xml); return inTally({ id, narration: "x", payable: rv.payable, net: rv.net, employees: rv.employees }, "g" + i).allocs; });
    f.pv = () => Object.fromEntries(Array.from(f.copy.snap).map(([id], i) => ["g" + i, { day: "20261031", type: "Payroll", no: String(i + 1) }]));
    return f;
  };
  const wire = (w, f) => { w.env.g.TCloud = { on: () => true, has: () => true, book: () => ({ book: "b1" }), postThrough: () => ({ version: "2.5.18", computer: "PC-" + f.via, id: f.via }) };
    w.env.g.Bridge.post = async (pl) => { w.posts.push(pl); return { ok: true, results: [f.post(pl.vouchers[0])] }; }; w.env.readMonth = f.readMonth; return w; };
  const sheet = many(150), rows = rowsOf({ sheet }), t = night(rows);
  const once = (f, n) => { const p = f.paid(); return p.length === n && new Set(p).size === n; };
  // L: part 1 reaches Tally through X, the page closes before its answer is saved; an employee's category moves; the copy
  // has not caught up
  {
    const f = fake();
    const w = wire(world(rows, { sheet, closeAt: (d) => d.id === "dc-tp-202610-1" && d.state === "posted" }), f);
    try { await w.run(t.entry); } catch (x) { /* the page closed */ }
    const emps = sheet.map((r, i) => ({ name: r.name, category: i === 0 ? "Head Office" : "" }));
    const w2 = wire(world(rows, { sheet, emps, drafts: JSON.parse(JSON.stringify(w.drafts)) }), f);
    let r = await w2.run(t.entry);
    ok(!r.ok && /Tally’s copy is older than this send/.test(r.why) && f.tally.length === 1, "L: the copy older than part 1's send: waits, nothing sent (2.5.18 would answer alreadySent and Tally would get parts 2 and 3 with someone twice)");
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
    const w = wire(world(rows, { sheet, closeAt: (d) => d.id === "dc-tp-202610-1" && d.state === "posted" }), f);
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
    f.rec.X.set("dc-tp-202610-1", xa); f.copy.readAt = FRESH;
    const gone = { "dc-tp-202610-1": { id: "dc-tp-202610-1", dedupe: "payroll:202610", part: 1, parts: 2, state: "failed", sent: { xml: xa, at: "2026-11-22T10:00:00Z", via: "X", answered: "gone" }, results: { "dc-tp-202610-1": { ok: false, state: "failed", said: "not in Tally" } }, vouchers: [{ xml: xa }] } };
    const emps = sheet.map((r, i) => ({ name: r.name, category: i === 0 ? "Head Office" : "" }));
    const w = wire(world(rows, { sheet, emps, drafts: gone }), f);
    const r = await w.run(t.entry);
    ok(!r.ok && /sent part 1 before with other contents/.test(r.why) && f.tally.length === 0 && w.posts.length === 1 && w.log.includes("entry_release"), "L3: alreadySent for other contents than the record: refused, released, parts 2 and 3 never sent");
  }
  // drafts lost: part 1 in Tally (the copy read in), no draft at all: counted from its FinCom id; only part 2 posted
  {
    const f = fake();
    const w = wire(world(rows, { sheet, closeAt: (d) => d.id === "dc-tp-202610-2" && d.state === "posting" }), f);
    try { await w.run(t.entry); } catch (x) { /* the page closed */ }
    f.sync();
    const rowsS = f.books(sheet), tS = night(rowsS);
    ok(tS.entry && tS.entry.ready, "drafts lost: the night still prepares the month (part 1 of 2 in the books by its own narration)");
    const w2 = wire(world(rowsS, { sheet, allocs: f.allocs(), pv: f.pv() }), f);
    const r = await w2.run(tS.entry);
    ok(r.ok && once(f, 150) && f.tally.length === 2 && w2.drafts["dc-tp-202610-1"] && w2.drafts["dc-tp-202610-1"].results["dc-tp-202610-1"].ok, "  Approve: part 1 counted as in Tally from its FinCom id (a draft made for it); only part 2 posted; everyone once");
    const tD = night(f.books(sheet), { draftRecs: [] });
    f.sync();
    ok(!night(f.books(sheet)).entry && tD.entry, "  the night counts the month done from the two FinCom ids in the books (no drafts needed)");
  }
  // drafts lost, the books here not read since, Approve on another computer (Y: no record of part 1): Tally's copy in the
  // cloud has part 1's FinCom id; only part 2 posted
  {
    const f = fake();
    const w = wire(world(rows, { sheet, closeAt: (d) => d.id === "dc-tp-202610-2" && d.state === "posting" }), f);
    try { await w.run(t.entry); } catch (x) { /* the page closed */ }
    f.sync(); f.via = "Y";
    const w2 = wire(world(rows, { sheet }), f);
    const r = await w2.run(t.entry);
    ok(r.ok && once(f, 150) && f.tally.length === 2 && !f.rec.Y.has("dc-tp-202610-1"), "drafts lost, the books here behind: part 1 counted from FinCom's id in Tally's copy; never sent again through Y; everyone once");
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
